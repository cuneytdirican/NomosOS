/**
 * PLATFORM TARAFI KREDİ YÖNETİMİ — `/api/admin/v1/credits/*`, `/model-prices`.
 *
 * Üç sorumluluk:
 *   1. Tenant başına kota/tüketim görünürlüğü.
 *   2. Fiyat yönetimi (AiTaskCost + ModelPrice) — kod dağıtımı gerektirmez.
 *   3. MALİYET / GELİR / MARJ raporu — Modül 25'in "panel token sayar,
 *      fiyatlamaz" ilkesi YALNIZCA BYO-LLM tenant'ları için geçerlidir;
 *      yönetilen tenant'ta maliyet NomosOS'undur ve görünür olmalıdır.
 *
 * MANUEL KREDİ TAHSİSİ BU SERVİSTE UYGULANMAZ: dört-göz onayına tabidir
 * (iş kuralı 9), talebi `PlatformApprovalsService` açar ve onay verildiğinde
 * `PlatformApprovalExecutorService` uygular.
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AiProviderType, type SubscriptionStatus } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformAuditService } from "../platform/platform-audit.service";
import { Pseudonymizer } from "../platform/platform-serialize";
import { isMasked } from "../platform/platform-permissions";
import type { PlatformAuthUser } from "../platform/platform.types";
import { BillingModeService } from "./billing-mode.service";
import { CreditService } from "./credit.service";
import { ModelPriceService } from "./model-price.service";
import {
  adjustmentRejection,
  availableCredits,
  settledBalance,
  usagePercent,
} from "./credit-plans";
import type { AdminUpdateTaskCostInput, AdminUpsertModelPriceInput } from "./credits.dto";

/**
 * Marj hesabının parametreleri.
 *
 * `SystemSetting["credits.margin_params"]` → { creditUnitPrice, currency, usdTryRate }
 * Yoksa: birim fiyat en küçük AKTİF paketten türetilir, kur `USD_TRY_RATE`
 * ortam değişkeninden okunur. Kur tanımlı değilse MARJ HESAPLANMAZ ve rapor
 * bunu açıkça söyler — uydurma kurla üretilmiş bir marj, hiç marj olmamasından
 * tehlikelidir.
 */
export const MARGIN_SETTING_KEY = "credits.margin_params";

/**
 * Kredi listesi satırı. Cüzdanı OLAN ve OLMAYAN bürolar aynı listede döner;
 * cüzdansız satırlarda sayısal alanlar `null`'dur — sıfır DEĞİL. Sıfır
 * "ölçüldü, hiç kullanılmamış" demektir; `null` "hiç ölçülmüyor" demektir ve
 * bu iki durum panelde birbirine karıştırılmamalıdır.
 */
interface TenantCreditRow {
  tenantId: string | null;
  tenantAdi: string;
  mod: string;
  cuzdanYok: boolean;
  uyari: string | null;
  plan: string | null;
  koltuk: number | null;
  abonelikDurumu: SubscriptionStatus | null;
  donemBaslangic: Date | null;
  donemBitis: Date | null;
  dahilKota: number | null;
  dahilTuketilen: number | null;
  satinAlinan: number | null;
  rezerve: number | null;
  kullanilabilir: number | null;
  kullanimYuzdesi: number | null;
  belgeKotasi: number | null;
  belgeKullanilan: number | null;
  otomatikYukleme: string | null;
  toplamTuketilenKredi: number;
  tuketimHareketi: number;
}

interface MarginParams {
  creditUnitPrice: Prisma.Decimal | null;
  currency: string;
  usdTryRate: Prisma.Decimal | null;
  source: string;
}

@Injectable()
export class PlatformCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly credits: CreditService,
    private readonly billing: BillingModeService,
    private readonly prices: ModelPriceService,
  ) {}

  // =========================================================================
  // Tenant kota/tüketim listesi
  // =========================================================================

  async listTenants(actor: PlatformAuthUser, query: { q?: string; mode?: string }) {
    const masked = isMasked(actor.role, "credits.tenant.view");
    const pseudo = new Pseudonymizer();

    const [wallets, exempt] = await Promise.all([
      this.prisma.client.creditWallet.findMany({ orderBy: { updatedAt: "desc" }, take: 500 }),
      this.billing.exemptTenantIds(),
    ]);
    const walletTenantIds = new Set(wallets.map((w) => w.tenantId));

    /**
     * CÜZDANI OLMAYAN BÜROLAR DA LİSTELENİR.
     *
     * Liste yalnız `creditWallet` üzerinden gidiyordu; cüzdanı olmayan bir büro
     * panelde HİÇ GÖRÜNMÜYORDU. Oysa cüzdansız tenant `BillingModeService`
     * tarafından SINIRSIZ sayılır: kredi kapısı hiç çalışmaz, AI ücretsiz ve
     * ölçümsüzdür. Yani ölçümden kaçan tek büro tipi, panelde görülmesi
     * imkânsız olan tipti. Ölçümsüzlük bilinçli bir karar olabilir; ama kaydın
     * yokluğunun yan etkisi olarak GÖRÜNMEZ kalmamalıdır.
     */
    const allTenants = await this.prisma.client.tenant.findMany({
      select: { id: true, name: true },
      take: 1000,
    });
    const walletlessTenantIds = allTenants
      .map((t) => t.id)
      .filter((id) => !walletTenantIds.has(id));
    const tenantIds = [...walletTenantIds, ...walletlessTenantIds];

    const [tenants, subs, spend] = await Promise.all([
      this.prisma.client.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      }),
      this.prisma.client.subscription.findMany({
        where: { tenantId: { in: tenantIds } },
        select: { tenantId: true, planKey: true, seats: true, status: true },
      }),
      this.prisma.client.creditTransaction.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds }, type: "TUKETIM" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    const subOf = new Map(subs.map((s) => [s.tenantId, s]));
    const spendOf = new Map(spend.map((s) => [s.tenantId, s]));

    const rows: TenantCreditRow[] = wallets.map((w) => {
      const mode = exempt.has(w.tenantId) ? "BYO_LLM" : "YONETILEN";
      const sub = subOf.get(w.tenantId);
      return {
        tenantId: masked ? null : w.tenantId,
        tenantAdi: masked ? pseudo.alias(w.tenantId) : nameOf.get(w.tenantId) ?? "(silinmiş büro)",
        mod: mode,
        cuzdanYok: false,
        uyari: null as string | null,
        plan: sub?.planKey ?? null,
        koltuk: sub?.seats ?? null,
        abonelikDurumu: sub?.status ?? null,
        donemBaslangic: w.periodStart,
        donemBitis: w.periodEnd,
        dahilKota: w.includedCredits,
        dahilTuketilen: w.includedConsumed,
        satinAlinan: w.purchasedCredits,
        rezerve: w.reservedCredits,
        kullanilabilir: availableCredits(w),
        kullanimYuzdesi: usagePercent(w),
        belgeKotasi: w.documentQuota,
        belgeKullanilan: w.documentUsed,
        otomatikYukleme: w.autoTopUpPackageKey,
        toplamTuketilenKredi: Math.abs(spendOf.get(w.tenantId)?._sum.amount ?? 0),
        tuketimHareketi: spendOf.get(w.tenantId)?._count._all ?? 0,
      };
    });

    // Cüzdansız bürolar — ölçümsüz çalışırlar, listede AÇIKÇA işaretlenirler.
    for (const id of walletlessTenantIds) {
      const sub = subOf.get(id);
      rows.push({
        tenantId: masked ? null : id,
        tenantAdi: masked ? pseudo.alias(id) : nameOf.get(id) ?? "(silinmiş büro)",
        mod: exempt.has(id) ? "BYO_LLM" : "SINIRSIZ",
        cuzdanYok: true,
        uyari:
          "Kredi cüzdanı YOK — kredi kapısı hiç çalışmıyor, AI işlemleri kotasız sürüyor. " +
          "Ölçüm isteniyorsa cüzdan açılmalıdır.",
        plan: sub?.planKey ?? null,
        koltuk: sub?.seats ?? null,
        abonelikDurumu: sub?.status ?? null,
        donemBaslangic: null,
        donemBitis: null,
        dahilKota: null,
        dahilTuketilen: null,
        satinAlinan: null,
        rezerve: null,
        kullanilabilir: null,
        kullanimYuzdesi: null,
        belgeKotasi: null,
        belgeKullanilan: null,
        otomatikYukleme: null,
        toplamTuketilenKredi: Math.abs(spendOf.get(id)?._sum.amount ?? 0),
        tuketimHareketi: spendOf.get(id)?._count._all ?? 0,
      });
    }

    const filtered = rows.filter((r) => {
      if (query.mode && r.mod !== query.mode) return false;
      if (query.q && !masked) {
        return (r.tenantAdi ?? "").toLocaleLowerCase("tr").includes(query.q.toLocaleLowerCase("tr"));
      }
      return true;
    });

    const walletless = filtered.filter((r) => r.cuzdanYok).length;

    await this.audit.log({
      actor,
      action: "CREDITS_TENANTS_VIEW",
      detail:
        `${filtered.length} büro listelendi (${walletless} tanesi CÜZDANSIZ)` +
        `${masked ? " (takma adlı görünüm)" : ""}.`,
    });

    // İ-36: sessiz kesim bildirimi — cüzdan/tenant tavanlarına takılındıysa
    // panel bilir; 500 cüzdan/1000 büro üstü kurulumda liste TAM DEĞİLDİR.
    const truncated = wallets.length >= 500 || allTenants.length >= 1000;

    return {
      items: filtered,
      total: filtered.length,
      maskeli: masked,
      cuzdansizSayisi: walletless,
      truncated,
      not:
        (truncated
          ? "Uyarı: liste cüzdan (500) veya büro (1000) tavanına takıldı — TÜM bürolar listelenmemiş olabilir. "
          : "") +
        (walletless > 0
          ? `${walletless} büronun kredi cüzdanı yok; bu bürolarda AI işlemleri KOTASIZ çalışıyor ve tüketim ölçülmüyor.`
          : ""),
    };
  }

  // =========================================================================
  // Fiyat listesi (AiTaskCost)
  // =========================================================================

  async listTaskCosts() {
    const rows = await this.prisma.client.aiTaskCost.findMany({
      orderBy: [{ isFree: "desc" }, { credits: "asc" }, { taskType: "asc" }],
    });
    return {
      items: rows,
      not:
        "Ücretsiz liste KODA GÖMÜLÜ DEĞİLDİR; kredi motoru `isFree` alanını okur. " +
        "Bir satırı ücretsize çevirmek o görevi anında bedava yapar.",
    };
  }

  async updateTaskCost(actor: PlatformAuthUser, input: AdminUpdateTaskCostInput) {
    const before = await this.prisma.client.aiTaskCost.findUnique({
      where: { taskType: input.taskType },
    });

    const row = await this.prisma.client.aiTaskCost.upsert({
      where: { taskType: input.taskType },
      create: {
        taskType: input.taskType,
        credits: input.isFree ? 0 : input.credits,
        isFree: input.isFree,
        description: input.description,
        updatedBy: actor.id,
      },
      update: {
        credits: input.isFree ? 0 : input.credits,
        isFree: input.isFree,
        ...(input.description !== undefined ? { description: input.description } : {}),
        updatedBy: actor.id,
      },
    });
    this.credits.invalidateCosts();

    await this.audit.log({
      actor,
      action: "CREDITS_TASK_COST_UPDATE",
      entity: "AiTaskCost",
      entityId: row.id,
      detail:
        `${input.taskType}: ${before ? `${before.credits} kredi (isFree=${before.isFree})` : "(yeni)"} → ` +
        `${row.credits} kredi (isFree=${row.isFree}). Değişiklik GERİYE DÖNÜK UYGULANMAZ; ` +
        "geçmiş hareketler eski fiyatla kalır.",
    });

    return {
      item: row,
      mesaj:
        "Fiyat güncellendi ve anında yürürlüğe girdi. Geçmiş tüketim hareketleri " +
        "DEĞİŞMEZ (iş kuralı 10).",
    };
  }

  // =========================================================================
  // Model fiyat tablosu (ModelPrice) — İÇ MALİYET
  // =========================================================================

  async listModelPrices(query: { providerType?: string; model?: string }) {
    const where: Prisma.ModelPriceWhereInput = {};
    if (query.providerType) where.providerType = query.providerType as AiProviderType;
    if (query.model) where.model = { contains: query.model, mode: "insensitive" };

    const rows = await this.prisma.client.modelPrice.findMany({
      where,
      orderBy: [{ providerType: "asc" }, { model: "asc" }, { effectiveFrom: "desc" }],
      take: 500,
    });

    // Aynı (sağlayıcı, model) için birden çok satır olabilir; hangisi bugün
    // yürürlükte, açıkça işaretlenir.
    const now = new Date();
    const currentKeys = new Set<string>();
    const items = rows.map((r) => {
      const key = `${r.providerType}|${r.model}`;
      const isCurrent = r.effectiveFrom <= now && !currentKeys.has(key);
      if (isCurrent) currentKeys.add(key);
      return {
        id: r.id,
        providerType: r.providerType,
        model: r.model,
        inputPricePer1M: r.inputPricePer1M.toFixed(4),
        outputPricePer1M: r.outputPricePer1M.toFixed(4),
        currency: r.currency,
        effectiveFrom: r.effectiveFrom,
        yururlukte: isCurrent,
      };
    });

    return {
      items,
      not:
        "GEÇMİŞ FİYATLAR SİLİNMEZ. Yeni fiyat, yeni bir `effectiveFrom` satırı olarak " +
        "eklenir; eski çağrıların maliyeti kendi tarihindeki fiyatla hesaplanmış kalır.",
    };
  }

  async upsertModelPrice(actor: PlatformAuthUser, input: AdminUpsertModelPriceInput) {
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
    // Gün başına normalize: aynı gün içinde iki farklı fiyat satırı, marj
    // raporunda hangisinin geçerli olduğunu belirsizleştirirdi.
    const day = new Date(
      Date.UTC(
        effectiveFrom.getUTCFullYear(),
        effectiveFrom.getUTCMonth(),
        effectiveFrom.getUTCDate(),
      ),
    );

    /**
     * GEÇMİŞ TARİHLİ SATIR DÜZELTİLEMEZ (iş kuralı 10).
     *
     * `upsert`'in `update` dalı, aynı gün için var olan satırın fiyatını
     * değiştiriyordu; yanıt yine "Geçmiş satırlar korundu" diyordu. Bugünün
     * satırını düzeltmek meşrudur (yanlış girilmiş bir fiyat aynı gün
     * düzeltilebilmelidir), geçmişi değiştirmek değildir: o satır, o tarihte
     * yapılmış çağrıların maliyet dayanağıdır.
     */
    const todayUtc = new Date();
    const today = new Date(
      Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()),
    );
    if (day < today) {
      const existing = await this.prisma.client.modelPrice.findUnique({
        where: {
          providerType_model_effectiveFrom: {
            providerType: input.providerType as AiProviderType,
            model: input.model,
            effectiveFrom: day,
          },
        },
      });
      if (existing) {
        throw new BadRequestException(
          `${input.providerType}/${input.model} için ${day.toISOString().slice(0, 10)} ` +
            "tarihli fiyat satırı zaten var ve GEÇMİŞ TARİHLİDİR; üzerine yazılamaz " +
            "(iş kuralı 10: fiyat değişikliği geriye dönük uygulanmaz). Yeni fiyatı " +
            "bugünün ya da ileri bir tarihin satırı olarak ekleyin.",
        );
      }
    }

    const row = await this.prisma.client.modelPrice.upsert({
      where: {
        providerType_model_effectiveFrom: {
          providerType: input.providerType as AiProviderType,
          model: input.model,
          effectiveFrom: day,
        },
      },
      create: {
        providerType: input.providerType as AiProviderType,
        model: input.model,
        inputPricePer1M: new Prisma.Decimal(input.inputPricePer1M),
        outputPricePer1M: new Prisma.Decimal(input.outputPricePer1M),
        currency: input.currency ?? "USD",
        effectiveFrom: day,
      },
      update: {
        inputPricePer1M: new Prisma.Decimal(input.inputPricePer1M),
        outputPricePer1M: new Prisma.Decimal(input.outputPricePer1M),
        currency: input.currency ?? "USD",
      },
    });
    this.prices.invalidate();

    await this.audit.log({
      actor,
      action: "MODEL_PRICE_UPSERT",
      entity: "ModelPrice",
      entityId: row.id,
      detail:
        `${row.providerType}/${row.model} · girdi ${row.inputPricePer1M.toFixed(4)} · ` +
        `çıktı ${row.outputPricePer1M.toFixed(4)} ${row.currency} · yürürlük ${day.toISOString().slice(0, 10)}.`,
    });

    return { item: row, mesaj: "Model fiyatı kaydedildi. Geçmiş satırlar korundu." };
  }

  // =========================================================================
  // Marj raporu
  // =========================================================================

  private async marginParams(): Promise<MarginParams> {
    const setting = await this.prisma.client.systemSetting.findUnique({
      where: { key: MARGIN_SETTING_KEY },
    });
    if (setting) {
      try {
        const p = JSON.parse(setting.valueJson) as {
          creditUnitPrice?: string;
          currency?: string;
          usdTryRate?: string;
        };
        return {
          creditUnitPrice: p.creditUnitPrice ? new Prisma.Decimal(p.creditUnitPrice) : null,
          currency: p.currency ?? "TRY",
          usdTryRate: p.usdTryRate ? new Prisma.Decimal(p.usdTryRate) : null,
          source: `SystemSetting["${MARGIN_SETTING_KEY}"]`,
        };
      } catch {
        /* bozuk ayar → aşağıdaki türetmeye düş */
      }
    }

    const cheapest = await this.prisma.client.creditPackage.findFirst({
      where: { isActive: true },
      orderBy: { credits: "asc" },
    });
    const envRate = process.env.USD_TRY_RATE?.trim();
    return {
      creditUnitPrice: cheapest ? cheapest.price.div(new Prisma.Decimal(cheapest.credits)) : null,
      currency: cheapest?.currency ?? "TRY",
      usdTryRate: envRate ? new Prisma.Decimal(envRate) : null,
      source: cheapest
        ? `En küçük aktif paket (${cheapest.key}) birim fiyatından türetildi; kur USD_TRY_RATE ortam değişkeninden.`
        : "Aktif paket yok; birim fiyat türetilemedi.",
    };
  }

  /**
   * Tenant başına MALİYET / TAHSİL EDİLEN KREDİ / MARJ.
   *
   * MALİYET USD, GELİR TL'dir. Kur tanımlı değilse marj HESAPLANMAZ ve rapor
   * `marjHesaplanabilir: false` döner: iki para birimini sessizce toplamaktansa
   * eksik rapor vermek doğrudur.
   */
  async margin(actor: PlatformAuthUser, query: { from?: string; to?: string }) {
    const masked = isMasked(actor.role, "credits.margin.view");
    const pseudo = new Pseudonymizer();

    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

    const [usage, exempt, params] = await Promise.all([
      this.prisma.client.aiUsageLog.groupBy({
        by: ["tenantId"],
        where: { createdAt: { gte: from, lte: to } },
        _sum: { estimatedCost: true, creditsCharged: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
      this.billing.exemptTenantIds(),
      this.marginParams(),
    ]);

    const tenantIds = usage.map((u) => u.tenantId);
    const [tenants, unpriced] = await Promise.all([
      this.prisma.client.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      }),
      this.prisma.client.aiUsageLog.groupBy({
        by: ["tenantId"],
        where: { createdAt: { gte: from, lte: to }, estimatedCost: null },
        _count: { _all: true },
      }),
    ]);
    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    const unpricedOf = new Map(unpriced.map((u) => [u.tenantId, u._count._all]));

    const rate = params.usdTryRate;
    const unit = params.creditUnitPrice;
    const canCompute = Boolean(rate && unit);

    const items = usage.map((u) => {
      const costUsd = u._sum.estimatedCost ?? new Prisma.Decimal(0);
      const credits = u._sum.creditsCharged ?? 0;
      const mode = exempt.has(u.tenantId) ? "BYO_LLM" : "YONETILEN";

      // BYO-LLM tenant'ında maliyet BÜRODADIR; NomosOS'a gelir de gider de
      // yazılmaz. Rakamlar gösterilir ama marj hesabına GİRMEZ.
      const revenueTry = unit ? unit.mul(new Prisma.Decimal(credits)).toDecimalPlaces(2) : null;
      const costTry = rate ? costUsd.mul(rate).toDecimalPlaces(2) : null;
      const marginTry =
        mode === "YONETILEN" && revenueTry && costTry ? revenueTry.sub(costTry) : null;

      return {
        tenantId: masked ? null : u.tenantId,
        tenantAdi: masked ? pseudo.alias(u.tenantId) : nameOf.get(u.tenantId) ?? "(silinmiş büro)",
        mod: mode,
        cagri: u._count._all,
        fiyatlanamayanCagri: unpricedOf.get(u.tenantId) ?? 0,
        girdiToken: u._sum.inputTokens ?? 0,
        ciktiToken: u._sum.outputTokens ?? 0,
        maliyetUsd: costUsd.toFixed(4),
        maliyetTl: costTry?.toFixed(2) ?? null,
        tahsilEdilenKredi: credits,
        gelirTl: mode === "YONETILEN" ? revenueTry?.toFixed(2) ?? null : null,
        marjTl: marginTry?.toFixed(2) ?? null,
        marjYuzde:
          marginTry && revenueTry && !revenueTry.isZero()
            ? marginTry.div(revenueTry).mul(100).toDecimalPlaces(1).toString()
            : null,
      };
    });

    const toplamMaliyetUsd = usage.reduce(
      (acc, u) => acc.add(u._sum.estimatedCost ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );
    const toplamKredi = usage.reduce((acc, u) => acc + (u._sum.creditsCharged ?? 0), 0);

    await this.audit.log({
      actor,
      action: "CREDITS_MARGIN_VIEW",
      detail:
        `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} · ` +
        `${items.length} tenant${masked ? " (takma adlı)" : ""}.`,
    });

    return {
      donem: { from, to },
      maskeli: masked,
      parametreler: {
        krediBirimFiyati: unit?.toDecimalPlaces(4).toString() ?? null,
        paraBirimi: params.currency,
        usdTryKuru: rate?.toString() ?? null,
        kaynak: params.source,
      },
      marjHesaplanabilir: canCompute,
      marjUyarisi: canCompute
        ? null
        : "Marj hesaplanamadı: kredi birim fiyatı ve/veya USD/TRY kuru tanımlı değil. " +
          `Maliyet USD, gelir TL cinsindedir; iki para birimi kur olmadan toplanmaz. ` +
          `SystemSetting["${MARGIN_SETTING_KEY}"] veya USD_TRY_RATE ile tanımlayın.`,
      toplam: {
        maliyetUsd: toplamMaliyetUsd.toFixed(4),
        tahsilEdilenKredi: toplamKredi,
        gelirTl: unit ? unit.mul(new Prisma.Decimal(toplamKredi)).toDecimalPlaces(2).toFixed(2) : null,
        marjTl:
          canCompute && unit && rate
            ? unit
                .mul(new Prisma.Decimal(toplamKredi))
                .sub(toplamMaliyetUsd.mul(rate))
                .toDecimalPlaces(2)
                .toFixed(2)
            : null,
      },
      items: items.sort((a, b) => Number(b.maliyetUsd) - Number(a.maliyetUsd)),
      not:
        "İÇ MUHASEBE — bu rakamlar KULLANICIYA GÖSTERİLMEZ. BYO-LLM tenant'larında AI " +
        "maliyeti büronun kendi sağlayıcı hesabındadır; o satırlarda marj hesaplanmaz. " +
        "Token bilgisi dönmeyen çağrılar (OLLAMA/CUSTOM) 'fiyatlanamayan çağrı' olarak " +
        "AYRI sayılır, maliyeti sıfır varsayılmaz.",
    };
  }

  // =========================================================================
  // Anormal tüketim (iş kuralı 11)
  // =========================================================================

  /**
   * Son 1 saatteki tüketim, önceki 24 saatin saatlik ortalamasının 10 katını
   * aşan tenant'lar. Sonuç bir UYARIDIR: hiçbir tenant otomatik kesilmez.
   */
  async anomalies() {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);

    const [lastHour, baseline] = await Promise.all([
      this.prisma.client.creditTransaction.groupBy({
        by: ["tenantId"],
        where: { type: "TUKETIM", createdAt: { gte: hourAgo } },
        _sum: { amount: true },
      }),
      this.prisma.client.creditTransaction.groupBy({
        by: ["tenantId"],
        where: { type: "TUKETIM", createdAt: { gte: dayAgo, lt: hourAgo } },
        _sum: { amount: true },
      }),
    ]);

    const baseOf = new Map(baseline.map((b) => [b.tenantId, Math.abs(b._sum.amount ?? 0) / 24]));
    const rows = lastHour
      .map((h) => {
        const recent = Math.abs(h._sum.amount ?? 0);
        const avg = baseOf.get(h.tenantId) ?? 0;
        return { tenantId: h.tenantId, sonSaat: recent, saatlikOrtalama: Math.round(avg * 10) / 10, kat: avg > 0 ? Math.round((recent / avg) * 10) / 10 : null };
      })
      .filter((r) => (r.kat !== null && r.kat >= 10) || (r.saatlikOrtalama === 0 && r.sonSaat >= 100));

    return {
      items: rows,
      not:
        "Anormal tüketim UYARIDIR. Hiçbir büro otomatik kesilmez; kritik eşikte " +
        "yavaşlatma (rate limit) uygulanır, hizmet durdurulmaz (iş kuralı 11).",
    };
  }

  // =========================================================================
  // Dört-göz onayı sonrası çağrılan yardımcılar
  // =========================================================================

  /** Cüzdanı yoksa açar — manuel tahsis öncesi platform tarafında kullanılır. */
  async ensureWallet(tenantId: string) {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException("Büro (tenant) bulunamadı.");
    return this.credits.ensureWallet(tenantId);
  }

  /**
   * Talep gövdesinin uygulanabilirliğini ÖNCEDEN doğrular (onay kuyruğuna çöp
   * girmesin). Kesin kapı UYGULAMA ANINDADIR: onay 72 saate kadar bekleyebilir
   * ve bugün geçerli olan bu kontrol o gün geçerli olmayabilir.
   */
  async validateAdjustment(tenantId: string, input: { deltaCredits?: number }) {
    const wallet = await this.prisma.client.creditWallet.findUnique({ where: { tenantId } });
    if (!wallet || input.deltaCredits === undefined) return;
    const rejection = adjustmentRejection(wallet, input.deltaCredits);
    if (rejection) throw new BadRequestException(rejection);
  }

  /** Tek tenant özeti — düzeltme ekranının başlığı. */
  async tenantDetail(actor: PlatformAuthUser, tenantId: string) {
    // MASKELEME BURADA DA UYGULANIR. `listTenants` maskeliyordu, bu uç
    // maskelemiyordu: matriste `credits.tenant.view` tek satır "masked"a
    // dönseydi liste korunur, detay sızdırırdı. Koruma, yetkinin okunduğu HER
    // yerde kurulmalıdır — birinde kurulup diğerinde unutulması, matrisi
    // güvenlik sınırı olmaktan çıkarır.
    const masked = isMasked(actor.role, "credits.tenant.view");
    const pseudo = new Pseudonymizer();

    const [wallet, tenant, exempt] = await Promise.all([
      this.prisma.client.creditWallet.findUnique({ where: { tenantId } }),
      this.prisma.client.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } }),
      this.billing.exemptTenantIds(),
    ]);
    if (!tenant) throw new NotFoundException("Büro (tenant) bulunamadı.");

    const recent = await this.prisma.client.creditTransaction.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 25,
    });

    await this.audit.log({
      actor,
      action: "CREDITS_TENANT_VIEW",
      tenantId,
      detail: `Kredi cüzdanı detayı görüntülendi${masked ? " (takma adlı görünüm)" : ""}.`,
    });

    return {
      maskeli: masked,
      tenantId: masked ? null : tenantId,
      tenantAdi: masked ? pseudo.alias(tenantId) : tenant.name,
      mod: exempt.has(tenantId) ? "BYO_LLM" : wallet ? "YONETILEN" : "SINIRSIZ",
      cuzdan: wallet
        ? {
            ...wallet,
            kullanilabilir: availableCredits(wallet),
            bakiye: settledBalance(wallet),
            kullanimYuzdesi: usagePercent(wallet),
          }
        : null,
      sonHareketler: recent,
      mutabakat: wallet ? await this.credits.reconcile(tenantId) : null,
      uyari: wallet
        ? null
        : "Bu büronun kredi cüzdanı YOK; kredi kapısı hiç çalışmaz ve AI işlemleri " +
          "KOTASIZ sürer. Ölçüm istiyorsanız cüzdan açın (manuel düzeltme ucu açar).",
    };
  }
}
