/**
 * KREDİ MOTORU — rezervasyon, mahsuplaşma, dönem yenileme, paket satın alma.
 *
 * ÇAĞRI AKIŞI (docs/moduller/26 §Çağrı Akışı):
 *   1. TAHMİN   estimateCredits(taskType, bağlamUzunluğu)
 *   2. SINIR    tahmin > 50 → 400, LLM'e GİTMEZ
 *   3. KONTROL  kullanılabilir < tahmin → 402, LLM'e GİTMEZ
 *   4. REZERVE  reservedCredits += tahmin      ← eşzamanlılık kilidi
 *   5. ÇAĞRI    sağlayıcı (KVKK maskeleme hattından sonra)
 *   6. MAHSUP   gerçek token → gerçek kredi → CreditTransaction; rezervasyon serbest
 *
 * REZERVASYONUN ÇEKİRDEĞİ — TEK KOŞULLU UPDATE:
 * Bakiye "önce oku, sonra yaz" ile korunamaz: iki istek arasındaki boşlukta
 * ikisi de "yeterli bakiye var" görür ve ikisi de geçer (kabul kriteri 2 tam
 * olarak bunu yasaklar). Bu yüzden rezervasyon TEK bir koşullu `UPDATE`
 * cümlesiyle yapılır; koşul satır kilidiyle birlikte değerlendirilir ve
 * `UPDATE ... WHERE kullanılabilir >= tahmin` ya 1 satır günceller ya 0.
 * `SELECT` yok, uygulama katmanında yarış yok.
 *
 * BAŞARISIZ ÇAĞRIDAN KREDİ ALINMAZ (iş kuralı 4): `release()` yalnızca
 * rezervasyonu geri verir, HİÇBİR `CreditTransaction` yazmaz. Hareket defterinde
 * "sonra iade edildi" gürültüsü olmaz; kabul kriteri 3 "CreditTransaction
 * oluşmaz" der, "sıfırlanır" demez.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma, type AiTaskCost, type CreditWallet } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";
import { BillingModeService, type ResolvedBilling } from "./billing-mode.service";
import { ModelPriceService } from "./model-price.service";
import { creditRunContext, type CreditRunStore } from "./credit-context";
import type { ParentCaseKind } from "./ai-credits.decorator";
import { insufficientCredits, requestTooLarge, type CreditPackageOffer } from "./credit.errors";
import {
  MAX_CREDITS_PER_REQUEST,
  adjustmentRejection,
  approximateTokens,
  availableCredits,
  contextMultiplier,
  estimateCredits,
  estimateUnitsCredits,
  nextPeriod,
  planQuota,
  settledBalance,
  usagePercent,
} from "./credit-plans";
import { estimateAnalysisUnits } from "../contracts/contract-analysis-chunks";

/** Kredi kapısının handler'a taşıdığı rezervasyon bileti. */
export interface CreditTicket {
  tenantId: string;
  userId: string;
  taskType: string;
  /** Rezerve edilen kredi. Mahsupta bundan FAZLASI tahsil edilmez. */
  reserved: number;
  baseCredits: number;
  /**
   * Biletin kapsadığı BİRİM (parça) sayısı — parça bazlı fiyatlamada mahsup
   * ÇAĞRI BAŞINA toplanır (bkz. settle). Varsayılan 1: tek çağrılı uçlar
   * önceki davranışını korur.
   */
  unitCount: number;
  /** Bilet kapandı mı? settle/release iki kez çalışmasın diye. */
  resolved: boolean;
  /** İzlenebilirlik — CreditTransaction.caseId. */
  caseId?: string;
}

/** Ücretsiz görev / muaf tenant: kapı çalışmadı. */
export type CreditGate =
  | { billed: false; billing: ResolvedBilling; reason: string }
  | { billed: true; billing: ResolvedBilling; ticket: CreditTicket };

const TASK_COST_CACHE_TTL_MS = 60_000;

/**
 * SAHİPSİZ REZERVASYON EŞİĞİ (denetim bulgusu Ö-13).
 *
 * Eski değer 15 dakikaydı ve sözleşmesi "tek bir LLM çağrısı 15 dakikadan uzun
 * sürmez" diyordu. Bu KENDİ AYAR ÜST SINIRIYLA ÇELİŞİYORDU:
 * `packages/ai/src/http.ts` `AI_TIMEOUT_MS` tavanı **600 saniyedir** ve
 * `caselaw/ai-search` `summarizeTop=5` ile ARDIŞIK 6 çağrı yapar — 15 dakika
 * rahatça aşılır. Aşıldığında süpürücü UÇUŞTAKİ rezervasyonu siliyor,
 * kullanılabilir bakiye olduğundan fazla görünüyor ve ardışık mahsuplar bakiyeyi
 * aşıyordu.
 *
 * Yeni eşik en kötü hâle bağlanır: tek çağrı üst sınırı (600 sn) × makul ardışık
 * çağrı sayısı (8) + pay. Süpürücü artık "hâlâ koşan bir işi" kesmez; yalnız
 * gerçekten ölmüş bir sürecin bıraktığı kilidi açar.
 */
const MAX_AI_CALL_MS = 600_000;
const MAX_SEQUENTIAL_AI_CALLS = 8;
const STALE_RESERVATION_TTL_MS = MAX_AI_CALL_MS * MAX_SEQUENTIAL_AI_CALLS + 5 * 60_000;

@Injectable()
export class CreditService implements OnModuleInit {
  private readonly logger = new Logger(CreditService.name);
  private costCache: { at: number; rows: AiTaskCost[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly billing: BillingModeService,
    private readonly prices: ModelPriceService,
  ) {}

  // =========================================================================
  // Fiyat listesi (AiTaskCost) — ÜCRETSİZ LİSTESİ KODA GÖMÜLMEZ (iş kuralı 3)
  // =========================================================================

  /** Tüm fiyat satırları (60 sn önbellekli). */
  async listCosts(): Promise<AiTaskCost[]> {
    const now = Date.now();
    if (this.costCache && now - this.costCache.at < TASK_COST_CACHE_TTL_MS) {
      return this.costCache.rows;
    }
    const rows = await this.prisma.client.aiTaskCost.findMany({ orderBy: [{ isFree: "desc" }, { credits: "asc" }] });
    this.costCache = { at: now, rows };
    return rows;
  }

  invalidateCosts(): void {
    this.costCache = null;
  }

  /**
   * Görev tipinin fiyatı.
   *
   * SATIRI OLMAYAN GÖREV: fail-open (bedava AI) da fail-closed (çalışmayan
   * özellik) da yanlıştır. Seçim: ÜCRETSİZ sayılır ama UYARI günlüğe düşer.
   * Gerekçe — kredi muhasebesindeki bir eksik, avukatın işini durdurmamalıdır
   * (spec §Limit Davranışı "asla engellenmeyecekler"); eksik satır panelden
   * dakikalar içinde eklenebilir, kilitlenmiş bir özellik ise fark edilene
   * kadar dosya işini durdurur.
   */
  async costOfTask(taskType: string): Promise<{ credits: number; isFree: boolean; known: boolean }> {
    const rows = await this.listCosts();
    const row = rows.find((r) => r.taskType === taskType);
    if (!row) {
      this.logger.warn(
        `AiTaskCost satırı yok: "${taskType}". Bu görev ÜCRETSİZ işlendi. ` +
          "Platform panelinden (/admin/v1/credits/costs) fiyat tanımlayın.",
      );
      return { credits: 0, isFree: true, known: false };
    }
    return { credits: row.isFree ? 0 : row.credits, isFree: row.isFree, known: true };
  }

  // =========================================================================
  // Cüzdan
  // =========================================================================

  async getWallet(tenantId: string) {
    const billing = await this.billing.resolve(tenantId);
    const wallet = billing.wallet;

    if (!wallet) {
      return {
        mod: billing.mode,
        limitsiz: true,
        aciklama: billing.note,
        cuzdan: null,
      };
    }

    return {
      mod: billing.mode,
      limitsiz: !billing.metered,
      aciklama: billing.note,
      cuzdan: this.walletDto(wallet),
    };
  }

  private walletDto(w: CreditWallet) {
    return {
      donemBaslangic: w.periodStart,
      donemBitis: w.periodEnd,
      dahilKota: w.includedCredits,
      dahilTuketilen: w.includedConsumed,
      satinAlinan: w.purchasedCredits,
      rezerve: w.reservedCredits,
      /** Şu an harcanabilir (rezerve düşülmüş). */
      kullanilabilir: availableCredits(w),
      /** Rezerve hariç bakiye — hareket defteriyle mutabık olan sayı. */
      bakiye: settledBalance(w),
      kullanimYuzdesi: usagePercent(w),
      belgeKotasi: w.documentQuota,
      belgeKullanilan: w.documentUsed,
      /**
       * Belge kotası AŞILDI mı? Sayaç bir UYARIDIR, kapı değildir: belge
       * yükleme ve belge hattı (sınıflandırma/çıkarma/süre tespiti) her
       * koşulda çalışır (iş kuralı 6, kabul kriteri 5).
       */
      belgeKotasiAsildi: w.documentQuota > 0 && w.documentUsed > w.documentQuota,
      otomatikYuklemePaketi: w.autoTopUpPackageKey,
      guncellendi: w.updatedAt,
    };
  }

  // =========================================================================
  // Tahmin
  // =========================================================================

  /**
   * `estimateCredits(taskType, contextLength)` — spec akış adımı 1.
   *
   * `contextChars` bilinmiyorsa 0 geçilir ve taban fiyat döner. Dosya bağlamının
   * gerçek uzunluğu (belgeler, safahat) çağrı anında `case-context` katmanında
   * oluşur; kapı onu ÖNCEDEN bilemez. Bu yüzden mahsupta tahsil edilen kredi
   * REZERVE EDİLENİ ASLA AŞMAZ (bkz. settle) — eksik rezervasyonu, spec'in
   * öngördüğü ~3 kat marj karşılar.
   */
  async estimate(taskType: string, contextChars: number) {
    const cost = await this.costOfTask(taskType);
    const tokens = approximateTokens(contextChars);
    const credits = cost.isFree ? 0 : estimateCredits(cost.credits, tokens);
    return {
      taskType,
      tabanKredi: cost.credits,
      ucretsiz: cost.isFree,
      fiyatTanimli: cost.known,
      yaklasikToken: tokens,
      uzunBaglamCarpani: contextMultiplier(tokens),
      tahminiKredi: credits,
      istekBasinaTavan: MAX_CREDITS_PER_REQUEST,
      tavaniAsiyor: credits > MAX_CREDITS_PER_REQUEST,
    };
  }

  /**
   * `POST /credits/estimate` — dosya bağlamı varsa uzunluğu SUNUCUDA ölçülür.
   * Arayüzdeki "… · 20 kredi" etiketinin ve düğme önizlemesinin kaynağı budur.
   */
  async estimateForCase(user: AuthUser, taskType: string, caseId?: string, contextChars?: number) {
    let chars = Math.max(0, contextChars ?? 0);
    if (caseId) {
      chars += await this.caseContextChars(user.tenantId, caseId);
    }
    return this.estimate(taskType, chars);
  }

  /**
   * Dosya bağlamının kaba karakter uzunluğu — DETERMİNİSTİK SAYMA, AI değil.
   *
   * NEDEN GEREKLİ: kapı yalnız istek gövdesine baksaydı 50 kredi tavanı fiilen
   * ölürdü. Pahalı işlerin (tam dosya analizi, strateji, simülasyon) bağlamı
   * gövdede değil DOSYADA durur: 400 belge parçalı bir dosyanın analizi,
   * gövdesi 80 bayt olan bir istekle tetiklenir. Ölçüm üç sayımdır (indeksli),
   * LLM'e gitmez ve yalnız `@AiCredits({ caseIdParam })` taşıyan uçlarda çalışır.
   *
   * @param strict `true` → dosya yoksa 404. Kapıdan çağrılırken `false`'tur:
   *   geçersiz bir dosya kimliğinin hata mesajını KREDİ KAPISI değil, işin
   *   kendi servisi vermelidir.
   */
  private async caseContextChars(
    tenantId: string,
    caseId: string,
    strict = true,
  ): Promise<number> {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true },
    });
    if (!found) {
      if (strict) throw new NotFoundException("Dosya bulunamadı.");
      return 0;
    }

    const [chunks, notes, events] = await Promise.all([
      this.prisma.client.documentChunk.count({
        where: { document: { caseId, tenantId } },
      }),
      this.prisma.client.caseNote.count({ where: { caseId, tenantId } }),
      this.prisma.client.timelineEvent.count({ where: { caseId } }),
    ]);
    // Parça başına ~1.200 karakter (chunker hedefi), not ~400, safahat ~120.
    return chunks * 1200 + notes * 400 + events * 120;
  }

  /**
   * Üst kayıttan dosya kimliği — TENANT SÜZGEÇLİ, TEK SORGU, AI YOK.
   *
   * Kapı yalnız `:caseId` taşıyan uçlarda dosya bağlamını görebiliyordu; 16
   * ücretli uçtan 11'inde bağlam uzunluğu istek gövdesinden tahmin ediliyor,
   * bu yüzden 50 kredi tavanı hiç tetiklenmiyor ve uzun bağlam ücreti hiç
   * tahsil edilmiyordu (bkz. AiCreditsMeta.parentCaseId).
   *
   * Bulunamayan kayıt SESSİZCE `undefined` döner: geçersiz kimliğin hatasını
   * kredi kapısı değil, işin kendi servisi vermelidir.
   */
  async resolveParentCaseIds(
    tenantId: string,
    kind: ParentCaseKind,
    ids: readonly string[],
  ): Promise<string[]> {
    const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
    if (unique.length === 0) return [];
    const p = this.prisma.client;

    try {
      switch (kind) {
        case "STRATEGY": {
          const rows = await p.strategy.findMany({
            where: { id: { in: unique }, tenantId },
            select: { caseId: true },
          });
          return rows.map((r) => r.caseId);
        }
        case "PETITION": {
          const rows = await p.petition.findMany({
            where: { id: { in: unique }, tenantId },
            select: { caseId: true },
          });
          return rows.map((r) => r.caseId).filter((v): v is string => !!v);
        }
        case "ENFORCEMENT": {
          const rows = await p.enforcementFile.findMany({
            where: { id: { in: unique }, tenantId },
            select: { caseId: true },
          });
          return rows.map((r) => r.caseId).filter((v): v is string => !!v);
        }
        case "EXPERT_REPORT": {
          const rows = await p.expertReport.findMany({
            where: { id: { in: unique }, tenantId },
            select: { caseId: true },
          });
          return rows.map((r) => r.caseId).filter((v): v is string => !!v);
        }
        case "CLAIM": {
          const rows = await p.claim.findMany({
            where: { id: { in: unique }, tenantId },
            select: { caseId: true },
          });
          return rows.map((r) => r.caseId);
        }
        case "EVIDENCE": {
          const rows = await p.evidence.findMany({
            where: { id: { in: unique }, tenantId },
            select: { caseId: true },
          });
          return rows.map((r) => r.caseId);
        }
        default:
          return [];
      }
    } catch (err) {
      // Kredi tahmini, işin kendisini durduracak bir şey değildir.
      this.logger.warn(
        `Üst kayıttan dosya kimliği çözülemedi (${kind}): ${(err as Error).message}. ` +
          "Tahmin taban fiyata düşürüldü.",
      );
      return [];
    }
  }

  // =========================================================================
  // Rezervasyon
  // =========================================================================

  /**
   * Sözleşme analizinin PARÇA ÖLÇÜSÜ — kredi kapısının sözleşme uzantısı.
   *
   * Sözleşme metni gövdede DEĞİL veritabanındadır (ContractVersion.contentText);
   * parça bazlı fiyat bunun uzunluğuna bağlıdır. Bu metot metni TENANT SÜZGEÇLİ
   * okur, analiz servisinin kullandığı AYNI chunker hesabıyla (bkz.
   * contract-analysis-chunks) parça sayısını çıkarır. Kayıt bulunamazsa
   * sessizce `undefined` döner: geçersiz kimliğin hatasını kredi kapısı değil,
   * işin kendi servisi vermelidir.
   */
  async resolveContractAnalysisUnits(
    tenantId: string,
    contractId: string | undefined,
    versionId?: string | undefined,
  ): Promise<{ count: number; charsPerUnit: number } | undefined> {
    if (!contractId) return undefined;
    try {
      const contract = await this.prisma.client.contract.findFirst({
        where: { id: contractId, tenantId },
        select: { currentVersionId: true },
      });
      if (!contract) return undefined;
      const targetVersionId = versionId ?? contract.currentVersionId;
      if (!targetVersionId) return undefined;
      const version = await this.prisma.client.contractVersion.findFirst({
        where: { id: targetVersionId, contract: { id: contractId, tenantId } },
        select: { contentText: true },
      });
      if (!version) return undefined;
      const estimate = estimateAnalysisUnits(version.contentText);
      if (estimate.chunkCount <= 0) return undefined;
      return { count: estimate.chunkCount, charsPerUnit: Math.max(1, estimate.chunkChars) };
    } catch (err) {
      this.logger.warn(
        `Sözleşme parça ölçüsü çözülemedi (${contractId}): ${(err as Error).message}. ` +
          "Tahmin taban fiyata düşürüldü.",
      );
      return undefined;
    }
  }

  /** Parça bazlı tahmin — analiz tahmin ucunun (`analyses/estimate`) kaynağı. */
  async estimateForUnits(
    taskType: string,
    units: { count: number; charsPerUnit: number },
  ) {
    const cost = await this.costOfTask(taskType);
    const perUnit = cost.isFree
      ? 0
      : estimateUnitsCredits(cost.credits, units).perUnit;
    return {
      taskType,
      tabanKredi: cost.credits,
      ucretsiz: cost.isFree,
      fiyatTanimli: cost.known,
      parcaSayisi: Math.max(1, Math.floor(units.count)),
      parcaBasiKredi: perUnit,
      tahminiKredi: perUnit * Math.max(1, Math.floor(units.count)),
      parcaBasiTavan: MAX_CREDITS_PER_REQUEST,
      parcaTavaniAsiyor: perUnit > MAX_CREDITS_PER_REQUEST,
    };
  }


  /**
   * Kapının tamamı: muafiyet → fiyat → 50 tavanı → 402 → rezervasyon.
   * Hiçbir dalda LLM çağrısı YAPILMAZ; bu metot dönmeden sağlayıcıya gidilmez.
   */
  async checkAndReserve(input: {
    user: AuthUser;
    taskType: string;
    contextChars: number;
    /** İzlenebilirlik: `CreditTransaction.caseId`. */
    caseId?: string;
    /**
     * Tahmine girecek TÜM dosyalar. `caseId` bunlardan biri olabilir; üst
     * kayıttan çözülenler (strateji, dilekçe, icra, bilirkişi raporu) buraya
     * eklenir. Karşılaştırma uçlarında iki ayrı dosya olabilir.
     */
    contextCaseIds?: readonly string[];
    /**
     * PARÇA BAZLI FİYATLAMA (map-reduce): rezervasyon = parça sayısı × parça
     * başına tahmin. Verilmezse tek birim varsayılır (önceki davranış).
     */
    units?: { count: number; charsPerUnit: number };
  }): Promise<CreditGate> {
    const billing = await this.billing.resolve(input.user.tenantId);

    if (!billing.metered || !billing.wallet) {
      return { billed: false, billing, reason: billing.note };
    }

    const cost = await this.costOfTask(input.taskType);
    if (cost.isFree || cost.credits <= 0) {
      return {
        billed: false,
        billing,
        reason: cost.known
          ? `"${input.taskType}" ücretsiz görev listesindedir (AiTaskCost.isFree).`
          : `"${input.taskType}" için fiyat satırı tanımlı değil; işlem ücretsiz sürdürüldü.`,
      };
    }

    // Dosya bağlamı da tahmine girer: yoksa 50 kredi tavanı hiç tetiklenmez
    // (pahalı işlerin uzunluğu gövdede değil dosyadadır).
    const contextCaseIds = [
      ...new Set([...(input.caseId ? [input.caseId] : []), ...(input.contextCaseIds ?? [])]),
    ];
    const caseChars = (
      await Promise.all(
        contextCaseIds.map((id) => this.caseContextChars(input.user.tenantId, id, false)),
      )
    ).reduce((sum, n) => sum + n, 0);

    // Parça bazlı uçlarda fiyat = parça sayısı × parça başına tahmin; tavan
    // PARÇA BAŞINA uygulanır (koşu N ayrı sağlayıcı çağrısıdır).
    const units = input.units
      ? estimateUnitsCredits(cost.credits, {
          count: input.units.count,
          charsPerUnit: Math.max(1, input.units.charsPerUnit),
        })
      : null;
    const tokens = approximateTokens(input.contextChars + caseChars);
    const required = units ? units.total : estimateCredits(cost.credits, tokens);
    const unitCount = units ? Math.max(1, Math.floor(input.units?.count ?? 1)) : 1;

    // 2. SINIR — LLM'e gidilmeden reddedilir (kabul kriteri 7). Parça bazlı
    // uçlarda sınır parça başınadır; toplam parça sayısıyla ölçeklenir.
    const perRequest = units ? units.perUnit : required;
    if (perRequest > MAX_CREDITS_PER_REQUEST) {
      throw requestTooLarge({ taskType: input.taskType, required: perRequest });
    }

    // Sahipsiz rezervasyonlar bakiyeyi kilitlemesin: kapı her çalıştığında
    // bu tenant'ın süresi geçmiş rezervasyonu varsa önce o serbest bırakılır
    // (bkz. sweepStaleReservations).
    await this.sweepStaleReservations(input.user.tenantId);

    // 3+4. KONTROL ve REZERVE — tek koşullu UPDATE (kabul kriteri 2).
    const reservedRows = await this.reserve(input.user.tenantId, required);

    if (reservedRows === 0) {
      // Bakiye yetmedi. Otomatik yükleme açıksa bir kez denenip tekrar bakılır.
      const topped = await this.tryAutoTopUp(input.user, billing.wallet, required);
      if (topped) {
        const retry = await this.reserve(input.user.tenantId, required);
        if (retry > 0) {
          return {
            billed: true,
            billing,
            ticket: this.newTicket(input, required, cost.credits, unitCount),
          };
        }
      }
      const fresh = await this.prisma.client.creditWallet.findUnique({
        where: { tenantId: input.user.tenantId },
      });
      throw insufficientCredits({
        taskType: input.taskType,
        available: fresh ? Math.max(0, availableCredits(fresh)) : 0,
        required,
        packages: await this.packageOffers(),
      });
    }

    return {
      billed: true,
      billing,
      ticket: this.newTicket(input, required, cost.credits, unitCount),
    };
  }

  /**
   * Rezervasyonun tek koşullu `UPDATE`'i. Koşul satır kilidinden SONRA yeniden
   * değerlendirilir; ya 1 satır güncellenir ya 0.
   *
   * `reservedSince` yalnız sayaç 0'dan yukarı çıkarken damgalanır
   * (`COALESCE` ile): iç içe rezervasyonlarda damga, EN ESKİ açık
   * rezervasyonu gösterir ve süpürücü erken tetiklenmez.
   */
  private async reserve(tenantId: string, required: number): Promise<number> {
    return this.prisma.client.$executeRaw`
      UPDATE "CreditWallet"
      SET "reservedCredits" = "reservedCredits" + ${required},
          -- O-13: damga EN SON rezervasyona gore tazelenir.
          -- Eskiden COALESCE(reservedSince, NOW()) yazilidi: damga yalniz
          -- 0-pozitif gecisinde konuyor, ESZAMANLI IKINCI rezervasyon onu
          -- tazelemiyordu. Damga en ESKI acik rezervasyonu gosteriyor ve supurucu,
          -- saniyeler once acilmis TAZE bir rezervasyonu da (sutunu toptan
          -- sifirladigi icin) siliyordu. NOW() ters yonde risk tasir (en eski
          -- rezervasyon gec supurulur) ama supurucunun YANLIS POZITIFI -- ucustaki
          -- bir isin kredisini serbest birakip ayni krediyi iki kez harcatmak --
          -- cok daha yikicidir. TTL de artik en kotu hale gore olculudur.
          "reservedSince" = NOW(),
          "updatedAt" = NOW()
      WHERE "tenantId" = ${tenantId}
        AND ("includedCredits" - "includedConsumed") + "purchasedCredits" - "reservedCredits" >= ${required}
    `;
  }

  private newTicket(
    input: { user: AuthUser; taskType: string; caseId?: string },
    reserved: number,
    baseCredits: number,
    unitCount = 1,
  ): CreditTicket {
    return {
      tenantId: input.user.tenantId,
      userId: input.user.userId,
      taskType: input.taskType,
      reserved,
      baseCredits,
      unitCount,
      resolved: false,
      caseId: input.caseId,
    };
  }

  // =========================================================================
  // Mahsuplaşma
  // =========================================================================

  /**
   * Gerçek tüketimi yazar ve rezervasyonu kapatır.
   *
   * TAHSİL EDİLEN = min(rezerve, gerçek token'dan hesaplanan kredi).
   * Tavan REZERVEDİR: kullanıcıya kapıda verilen tahminden fazlası tahsil
   * edilmez ve bakiye asla negatife düşemez. Rezervasyonun eksik kaldığı
   * (bağlamın tahminden uzun çıktığı) durumu spec'in ~3 kat marjı karşılar.
   *
   * HİÇ SAĞLAYICI ÇAĞRISI OLMADIYSA (handler AI'a hiç gitmedi, ör. `useAi:false`
   * ya da tamamen deterministik sonuç) tahsil 0'dır ve hareket YAZILMAZ.
   */
  async settle(ticket: CreditTicket, store: CreditRunStore): Promise<void> {
    if (ticket.resolved) return;
    ticket.resolved = true;

    const calls = store.calls;
    if (calls.length === 0) {
      await this.releaseReservation(ticket.tenantId, ticket.reserved);
      this.logger.debug(
        `${ticket.taskType}: sağlayıcı çağrısı yapılmadı, ${ticket.reserved} kredi rezervasyonu iade edildi.`,
      );
      return;
    }

    // FİYATLANAN ÇAĞRILAR — yalnız BİLETİN GÖREV TİPİNDEKİLER.
    // Bir istek içinde birden çok görev tipi koşabilir (ör. içtihat AI
    // aramasında 1 ücretli planlama + N ÜCRETSİZ özetleme). Hepsinin token'ını
    // toplamak, ücretsiz görevlerin ücretli görevin uzun bağlam çarpanını
    // şişirmesi demektir. Eşleşen çağrı yoksa (görev tipi çalışma anında
    // değişmişse) tüm çağrılara geri düşülür — ücret hiç alınmaması, yanlış
    // alınmasından iyi olsa da burada çağrı GERÇEKTEN yapılmıştır.
    const billable = calls.filter((c) => c.taskType === ticket.taskType);
    const priced = billable.length > 0 ? billable : calls;

    const totalInput = priced.reduce((sum, c) => sum + (c.inputTokens ?? 0), 0);
    // PARÇA BAZLI BİLET: her parça AYRI bir sağlayıcı çağrısıdır; fiyat ÇAĞRI
    // BAŞINA toplanır (parça sayısı × parça fiyatı). Tek birimli biletlerde
    // önceki davranış korunur: tüm girdi toplanır, çarpan bir kez uygulanır.
    const computed =
      ticket.unitCount > 1
        ? priced.reduce((sum, c) => sum + estimateCredits(ticket.baseCredits, c.inputTokens ?? 0), 0)
        : estimateCredits(ticket.baseCredits, totalInput);
    const charged = Math.max(0, Math.min(ticket.reserved, computed));

    // Gerçek maliyet — çağrı başına, ModelPrice üzerinden (iç muhasebe).
    const costs = await Promise.all(
      calls.map((c) =>
        this.prices.costOf({
          providerType: c.providerType,
          model: c.model,
          inputTokens: c.inputTokens ?? null,
          outputTokens: c.outputTokens ?? null,
        }),
      ),
    );

    try {
      await this.prisma.client.$transaction(async (tx) => {
        // KOVA AYRIMI TEK SQL CÜMLESİNDE — "önce oku, sonra yaz" DEĞİL.
        //
        // Eski hâlde `includedLeft` işlem içinde okunuyor ama yazma anında
        // yeniden değerlendirilmiyordu: iki eşzamanlı mahsup aynı `includedLeft`
        // değerini görüp ikisi de dahil kotadan düşülmüş sayıyor ve
        // `includedConsumed > includedCredits` oluyordu. Toplam bakiye doğru
        // kalsa da dönem yenilemesinde `expiring = max(0, dahil - tüketilen)`
        // sıfır çıktığı için yanan kota deftere hiç yazılmıyor ve mutabakat
        // kalıcı olarak bozuluyordu (iş kuralı 8 + kabul kriteri 9).
        //
        // `LEAST/GREATEST` satır kilidinden SONRAKİ değerlerle hesaplanır.
        //
        // Aşağıdaki okuma KARARI DEĞİL, yalnız hareket notundaki kova kırılımını
        // besler; ayrım her hâlükârda SQL cümlesinin kendisinde yapılır.
        const before = await tx.creditWallet.findUnique({
          where: { tenantId: ticket.tenantId },
          select: { includedConsumed: true },
        });

        await tx.$executeRaw`
          UPDATE "CreditWallet"
          SET "includedConsumed" = "includedConsumed"
                + LEAST(${charged}::int, GREATEST(0, "includedCredits" - "includedConsumed")),
              -- Ö-13 ASIMETRISI GIDERILDI: reservedCredits GREATEST(0, ...) ile
              -- korunuyordu, purchasedCredits korunmuyordu ve NEGATIFE dusebiliyordu.
              -- Kasitsiz bir asimetriydi: bakiye eksiye dustugunde reconcile()
              -- sonradan tutarli:false raporluyor ama kredi zaten harcanmis oluyordu.
              "purchasedCredits" = GREATEST(0, "purchasedCredits"
                - (${charged}::int - LEAST(${charged}::int, GREATEST(0, "includedCredits" - "includedConsumed")))),
              "reservedCredits" = GREATEST(0, "reservedCredits" - ${ticket.reserved}::int),
              "reservedSince" = CASE
                WHEN GREATEST(0, "reservedCredits" - ${ticket.reserved}::int) = 0 THEN NULL
                ELSE "reservedSince"
              END,
              "updatedAt" = NOW()
          WHERE "tenantId" = ${ticket.tenantId}
        `;

        const updated = await tx.creditWallet.findUnique({
          where: { tenantId: ticket.tenantId },
        });
        if (!updated) {
          // Cüzdan koşu sırasında silinmişse borç yazacak yer yok.
          this.logger.warn(`Cüzdan bulunamadı, mahsup atlandı (tenant ${ticket.tenantId}).`);
          return;
        }

        const fromIncluded = Math.max(0, updated.includedConsumed - (before?.includedConsumed ?? 0));
        const fromPurchased = Math.max(0, charged - fromIncluded);

        /** Tahsilatın yazılacağı kayıt: fiyatlanan İLK çağrı. */
        const chargedLogId = priced[0]?.aiUsageLogId ?? calls[0]?.aiUsageLogId ?? null;

        if (charged > 0) {
          await tx.creditTransaction.create({
            data: {
              tenantId: ticket.tenantId,
              userId: ticket.userId,
              type: "TUKETIM",
              amount: -charged,
              taskType: ticket.taskType,
              caseId: ticket.caseId ?? null,
              aiUsageLogId: chargedLogId,
              balanceAfter: settledBalance(updated),
              note:
                `${calls.length} sağlayıcı çağrısı (${priced.length} tanesi ${ticket.taskType} ` +
                `olarak fiyatlandı) · ${totalInput} girdi token · ` +
                `dahil kotadan ${fromIncluded}, satın alınandan ${fromPurchased}.`,
            },
          });
        }

        // Kullanım kayıtlarına kredi ve gerçek maliyet işlenir.
        // TAHSİLAT TEK KALEMDİR: kredi fiyatlanan İLK çağrıya yazılır,
        // diğerlerine 0 — toplamları `CreditTransaction.amount` ile birebir
        // tutsun diye. Ücretsiz görevlerin çağrıları da 0 alır; maliyetleri
        // (`estimatedCost`) yine işlenir, iç muhasebe onları görmelidir.
        //
        // `updateMany` KULLANILIR, `update` DEĞİL (denetim bulgusu İ-13).
        //
        // `update`, satır bulunamazsa P2025 fırlatır ve bu döngü mahsup
        // transaction'ının İÇİNDEDİR: bir `AiUsageLog` satırı bu arada silinirse
        // (kiracı silme, veri temizliği, yarış) TÜM MAHSUP GERİ ALINIR ve
        // gerçekten yapılmış bir LLM çağrısı ÜCRETSİZ kalırdı. Cüzdanın
        // doğruluğu, bir yan kaydın varlığına bağlı olmamalıdır.
        //
        // `updateMany` eşleşme bulamazsa `{count: 0}` döner ve akış devam eder.
        for (let i = 0; i < calls.length; i += 1) {
          const id = calls[i].aiUsageLogId;
          if (!id) continue;
          const cost = costs[i];
          await tx.aiUsageLog.updateMany({
            where: { id },
            data: {
              creditsCharged: id === chargedLogId ? charged : 0,
              estimatedCost: cost.priced ? cost.amount : null,
              costCurrency: cost.priced ? cost.currency : null,
            },
          });
        }
      });
    } catch (err) {
      // Mahsup başarısız olsa bile rezervasyon askıda kalmamalı; aksi hâlde
      // bakiye kalıcı olarak kilitlenir.
      this.logger.error(`Kredi mahsubu yazılamadı: ${(err as Error).message}`);
      await this.releaseReservation(ticket.tenantId, ticket.reserved);
    }
  }

  /**
   * Rezervasyonu iade eder — başarısız / iptal / boş dönen çağrı.
   * HİÇBİR `CreditTransaction` yazılmaz (kabul kriteri 3).
   */
  async release(ticket: CreditTicket, reason: string): Promise<void> {
    if (ticket.resolved) return;
    ticket.resolved = true;
    await this.releaseReservation(ticket.tenantId, ticket.reserved);
    this.logger.debug(`${ticket.taskType}: ${ticket.reserved} kredi iade edildi (${reason}).`);
  }

  /** `GREATEST(0, …)` — sayaç hiçbir hata dalında negatife düşemez. */
  private async releaseReservation(tenantId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    try {
      await this.prisma.client.$executeRaw`
        UPDATE "CreditWallet"
        SET "reservedCredits" = GREATEST(0, "reservedCredits" - ${amount}),
            "reservedSince" = CASE
              WHEN GREATEST(0, "reservedCredits" - ${amount}::int) = 0 THEN NULL
              ELSE "reservedSince"
            END,
            "updatedAt" = NOW()
        WHERE "tenantId" = ${tenantId}
      `;
    } catch (err) {
      this.logger.error(`Rezervasyon iadesi yazılamadı: ${(err as Error).message}`);
    }
  }

  /**
   * SAHİPSİZ REZERVASYON SÜPÜRÜCÜSÜ.
   *
   * `reservedCredits` normalde aynı süreç içindeki `settle`/`release` ile
   * düşer. Süreç çağrı ORTASINDA ölürse (deploy, OOM, kill) ikisi de hiç
   * çalışmaz ve rezerve kredi veritabanında kalır. `kullanılabilir` formülü
   * rezerveyi düştüğü için o kredi BİR DAHA HARCANAMAZ; ne dönem yenileme
   * (bilerek dokunmaz) ne de platform düzeltmesi temizler.
   *
   * TTL BİR ÇAĞRININ ÜST SINIRIDIR: tek bir LLM çağrısı 15 dakikadan uzun
   * sürmez (sağlayıcı zaman aşımları çok daha kısadır). Bu süreyi aşmış bir
   * rezervasyon, sahibi olmayan rezervasyondur.
   *
   * NEDEN CRON DEĞİL, KAPININ İÇİNDE: süpürme, o tenant'ın bir sonraki AI
   * çağrısında zaten çalışır — yani kilidin fark edileceği tek an. Ayrıca
   * `onModuleInit`'te bir kez tüm tenant'lar için koşar; böylece çöken sürecin
   * bıraktığı kilit, yeniden başlatmada anında çözülür.
   *
   * @param tenantId verilirse yalnız o cüzdan, verilmezse TÜM cüzdanlar.
   */
  async sweepStaleReservations(tenantId?: string): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_RESERVATION_TTL_MS);
    try {
      const rows = tenantId
        ? await this.prisma.client.$executeRaw`
            UPDATE "CreditWallet"
            SET "reservedCredits" = 0, "reservedSince" = NULL, "updatedAt" = NOW()
            WHERE "tenantId" = ${tenantId}
              AND "reservedCredits" > 0
              AND "reservedSince" IS NOT NULL
              AND "reservedSince" < ${cutoff}
          `
        : await this.prisma.client.$executeRaw`
            UPDATE "CreditWallet"
            SET "reservedCredits" = 0, "reservedSince" = NULL, "updatedAt" = NOW()
            WHERE "reservedCredits" > 0
              AND "reservedSince" IS NOT NULL
              AND "reservedSince" < ${cutoff}
          `;
      if (rows > 0) {
        this.logger.warn(
          `${rows} cüzdanda ${STALE_RESERVATION_TTL_MS / 60_000} dakikadan eski sahipsiz ` +
            "rezervasyon serbest bırakıldı. Bu, bir sürecin AI çağrısı ortasında " +
            "sonlandığına işaret eder. HİÇBİR CreditTransaction yazılmaz: rezerve " +
            "kredi hiç tüketilmemiştir.",
        );
      }
      return rows;
    } catch (err) {
      this.logger.error(`Sahipsiz rezervasyon süpürülemedi: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Açılışta bir kez: çöken sürecin bıraktığı kilitleri çöz. */
  async onModuleInit(): Promise<void> {
    await this.sweepStaleReservations();
  }

  /** Kapının handler'ı içinde çalıştırdığı bağlam. */
  newStore(ticket: CreditTicket): CreditRunStore {
    return { tenantId: ticket.tenantId, taskType: ticket.taskType, calls: [] };
  }

  /** Test ve elle çağrı için: bir işi kredi bağlamı içinde çalıştırır. */
  runInContext<T>(store: CreditRunStore, fn: () => T): T {
    return creditRunContext.run(store, fn);
  }

  // =========================================================================
  // Dönem yenileme
  // =========================================================================

  /**
   * `renewPeriod` — dahil kota SIFIRLANIR ve devretmez; satın alınan bakiye
   * KORUNUR (iş kuralı 7, kabul kriteri 8).
   *
   * ÇAĞIRAN — YALNIZ PLATFORM: kiracıya açık `POST /credits/renew` ucu
   * KALDIRILDI. Uç `force: true` kabul ediyordu ve kotasını tüketen bir büro,
   * dönemi bitmeden kotasını sıfırlayıp yeniden tahsis ettirebiliyordu; yani
   * sınırsız kredi basabiliyordu. Yenileme faturalama tarafının kararıdır.
   *
   * Faz 6 NOTU: bugün yalnız platformun dört-göz onaylı düzeltmesinden
   * tetiklenir. Zamanlayıcı Faz 6'da bu metodu DOĞRUDAN çağıracak (HTTP ucuna
   * ihtiyacı yok); sözleşmesi değişmeyecek.
   */
  async renewPeriod(tenantId: string, options: { force?: boolean; note?: string } = {}) {
    const wallet = await this.prisma.client.creditWallet.findUnique({ where: { tenantId } });
    if (!wallet) throw new NotFoundException("Bu büro için kredi cüzdanı tanımlı değil.");

    const now = new Date();
    if (!options.force && wallet.periodEnd > now) {
      throw new BadRequestException(
        `Dönem henüz bitmedi (bitiş ${wallet.periodEnd.toISOString().slice(0, 10)}). ` +
          "Erken yenileme için force=true gönderin.",
      );
    }

    const subscription = await this.prisma.client.subscription.findUnique({ where: { tenantId } });
    const quota = planQuota(subscription?.planKey, subscription?.seats ?? 1, {
      includedCredits: wallet.includedCredits,
      documentQuota: wallet.documentQuota,
    });
    const period = nextPeriod(now);

    const result = await this.prisma.client.$transaction(async (tx) => {
      /**
       * YANAN KOTA İŞLEM İÇİNDE YENİDEN OKUNUR.
       *
       * Yukarıdaki `wallet` fotoğrafı işlem DIŞINDA alınmıştır; araya giren bir
       * `settle` `includedConsumed`'ı artırmış olabilir. Eski hâlde `expiring`
       * o eski fotoğraftan hesaplanıyor ve deftere GERÇEKTE yanandan fazlası
       * yazılıyordu — mutabakat kalıcı olarak sapardı.
       */
      /**
       * ╔══════════════════════════════════════════════════════════════════╗
       * ║ DÖNEM KOŞULU İŞLEM İÇİNDE, YAZMANIN KENDİSİNDE UYGULANIR.        ║
       * ║ (denetim bulgusu 6 — çift tahsis penceresi)                      ║
       * ║                                                                  ║
       * ║ Yukarıdaki `periodEnd > now` kontrolü işlem DIŞINDADIR ve yalnız ║
       * ║ SIRALI koşuları korur. `JobRunnerService` kilidi SÜREÇ İÇİDİR;   ║
       * ║ iki API örneği çalışıyorsa ya da cron ile panelden tetikleme     ║
       * ║ çakışırsa iki çağrı da o kontrolü geçer, iki işlem açılır ve     ║
       * ║ İKİ `TAHSIS` hareketi yazılırdı. `includedConsumed` iki kez      ║
       * ║ sıfırlanır, büro o dönem için ÇİFT dahil kota alır ve            ║
       * ║ `balanceAfter` mutabakatı bozulurdu. Kredi paraya eşdeğerdir.    ║
       * ║ Üstelik ikinci koşuda `SURESI_DOLDU` satırı 0 yanar (kota zaten  ║
       * ║ sıfırlanmıştır) ve defter "hiç yanmadı" derdi.                   ║
       * ║                                                                  ║
       * ║ Koşullu `updateMany` bunu tek atomik adımda kapatır: yarışı      ║
       * ║ kaybeden çağrı `count === 0` görür ve HİÇBİR ŞEY yazmadan çıkar. ║
       * ║ Kilit satır üzerindedir; `force` verildiyse koşul aranmaz.       ║
       * ╚══════════════════════════════════════════════════════════════════╝
       */
      const claimed = await tx.creditWallet.updateMany({
        where: {
          tenantId,
          ...(options.force ? {} : { periodEnd: { lte: now } }),
        },
        // Dönemi HEMEN ileri taşı: bu yazma "bu dönemi ben yeniliyorum" ilanıdır.
        data: { periodStart: period.periodStart, periodEnd: period.periodEnd },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          "Kredi dönemi bu sırada başka bir koşu tarafından yenilendi; ikinci tahsis YAPILMADI. " +
            "Bu bir hata değildir, çift tahsis koruması devreye girmiştir.",
        );
      }

      const current = await tx.creditWallet.findUniqueOrThrow({ where: { tenantId } });
      const expiring = Math.max(0, current.includedCredits - current.includedConsumed);

      // Kullanılmayan dahil kota YANAR — hareket defterinde görünür olmalı.
      if (expiring > 0) {
        await tx.creditTransaction.create({
          data: {
            tenantId,
            type: "SURESI_DOLDU",
            amount: -expiring,
            balanceAfter: current.purchasedCredits,
            note: `Dönem sonunda kullanılmayan ${expiring} dahil kredi sıfırlandı (devretmez).`,
          },
        });
      }

      const updated = await tx.creditWallet.update({
        where: { tenantId },
        data: {
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          includedCredits: quota.credits,
          includedConsumed: 0,
          documentQuota: quota.documents,
          documentUsed: 0,
          // purchasedCredits ve reservedCredits BİLEREK dokunulmaz.
        },
      });

      await tx.creditTransaction.create({
        data: {
          tenantId,
          type: "TAHSIS",
          amount: quota.credits,
          balanceAfter: settledBalance(updated),
          note: `${options.note ? options.note + " " : ""}Dönem başı dahil kota tahsisi. ${quota.basis}`,
        },
      });

      return { updated, expiring };
    });

    return {
      cuzdan: this.walletDto(result.updated),
      /** İşlem İÇİNDE ölçülen gerçek yanan kota (deftere yazılan tutarla aynı). */
      sifirlanan: result.expiring,
      yeniKota: quota.credits,
      kotaGerekcesi: quota.basis,
      korunanSatinAlinan: result.updated.purchasedCredits,
    };
  }

  // =========================================================================
  // Paketler ve satın alma
  // =========================================================================

  async listPackages() {
    const rows = await this.prisma.client.creditPackage.findMany({
      where: { isActive: true },
      orderBy: { credits: "asc" },
    });
    return rows.map((p) => ({
      key: p.key,
      credits: p.credits,
      price: p.price.toFixed(2),
      currency: p.currency,
      birimFiyat: p.price.div(new Prisma.Decimal(p.credits)).toDecimalPlaces(4).toString(),
    }));
  }

  private async packageOffers(): Promise<CreditPackageOffer[]> {
    const rows = await this.prisma.client.creditPackage.findMany({
      where: { isActive: true },
      orderBy: { credits: "asc" },
    });
    return rows.map((p) => ({
      key: p.key,
      credits: p.credits,
      price: p.price.toFixed(2),
      currency: p.currency,
    }));
  }

  /**
   * Ek paket satın alma.
   *
   * FATURA MODELİ SEÇİMİ — `InvoiceRecord`, `Invoice` DEĞİL:
   * `Invoice` bürodan MÜVEKKİLE kesilen faturadır ve zorunlu bir `clientId`
   * taşır. Kredi paketi ise NomosOS'tan BÜROYA satılır; müvekkil yoktur.
   * `Invoice` kullanmak için sahte bir `Client` yaratmak gerekirdi ve bu,
   * büronun müvekkil listesini kirletirdi. `InvoiceRecord` zaten "platform →
   * büro" faturasıdır (Modül 25/09) ve e-Fatura akışına o taraftan girer.
   */
  async purchase(user: AuthUser, packageKey: string) {
    assertRole(user, ROLE_SETS.ONAY, "kredi paketi satın alma");

    const pkg = await this.prisma.client.creditPackage.findUnique({ where: { key: packageKey } });
    if (!pkg || !pkg.isActive) {
      throw new BadRequestException(`"${packageKey}" anahtarlı satılabilir bir paket bulunamadı.`);
    }

    const wallet = await this.prisma.client.creditWallet.findUnique({
      where: { tenantId: user.tenantId },
    });
    if (!wallet) {
      throw new BadRequestException(
        "Büronuz için kredi cüzdanı tanımlı değil; bu modda kota uygulanmadığı için paket " +
          "satın almanız gerekmiyor.",
      );
    }

    const result = await this.applyPurchase({
      tenantId: user.tenantId,
      userId: user.userId,
      pkg: { key: pkg.key, credits: pkg.credits, price: pkg.price, currency: pkg.currency },
      note: `Ek kredi paketi (${pkg.key}) satın alındı.`,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "KREDI_PAKETI_SATIN_ALMA",
      entity: "InvoiceRecord",
      entityId: result.fatura.id,
      detail: `${pkg.key} · ${pkg.credits} kredi · ${result.fatura.total} ${pkg.currency}`,
    });

    return result;
  }

  /** Satın almanın gövdesi — elle satın alma ve otomatik yükleme aynı yoldan geçer. */
  private async applyPurchase(input: {
    tenantId: string;
    userId?: string;
    pkg: { key: string; credits: number; price: Prisma.Decimal; currency: string };
    note: string;
  }) {
    const vatRate = new Prisma.Decimal("0.20"); // KDV %20
    const amount = input.pkg.price.toDecimalPlaces(2);
    const vatAmount = amount.mul(vatRate).toDecimalPlaces(2);
    const total = amount.add(vatAmount);

    return this.prisma.client.$transaction(async (tx) => {
      const wallet = await tx.creditWallet.update({
        where: { tenantId: input.tenantId },
        data: { purchasedCredits: { increment: input.pkg.credits } },
      });

      const invoice = await tx.invoiceRecord.create({
        data: {
          tenantId: input.tenantId,
          number: null, // Numara e-Fatura akışında verilir; taslak numarasız durur.
          amount,
          vatAmount,
          total,
          issueDate: new Date(),
          status: "TASLAK",
        },
      });

      await tx.creditTransaction.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          type: "SATIN_ALMA",
          amount: input.pkg.credits,
          balanceAfter: settledBalance(wallet),
          note: `${input.note} Fatura ${invoice.id} · ${total.toFixed(2)} ${input.pkg.currency} (KDV dâhil). Satın alınan kredilerin süresi dolmaz.`,
        },
      });

      return {
        paket: { key: input.pkg.key, credits: input.pkg.credits },
        cuzdan: this.walletDto(wallet),
        fatura: {
          id: invoice.id,
          amount: amount.toFixed(2),
          vatAmount: vatAmount.toFixed(2),
          total: total.toFixed(2),
          currency: input.pkg.currency,
          status: invoice.status,
          issueDate: invoice.issueDate,
        },
        mesaj:
          `${input.pkg.credits} kredi cüzdanınıza eklendi. Fatura TASLAK olarak oluşturuldu; ` +
          "e-Fatura akışına muhasebe tarafından gönderilir.",
      };
    });
  }

  /**
   * Otomatik yükleme (varsayılan KAPALI, iş kuralı 12).
   * Bakiye yetmediğinde kapı bunu BİR KEZ dener; başarısızsa 402 döner.
   */
  private async tryAutoTopUp(
    user: AuthUser,
    wallet: CreditWallet,
    required: number,
  ): Promise<boolean> {
    if (!wallet.autoTopUpPackageKey) return false;
    const pkg = await this.prisma.client.creditPackage.findUnique({
      where: { key: wallet.autoTopUpPackageKey },
    });
    if (!pkg || !pkg.isActive) {
      this.logger.warn(
        `Otomatik yükleme paketi "${wallet.autoTopUpPackageKey}" satışta değil; yükleme yapılmadı.`,
      );
      return false;
    }
    if (pkg.credits < required) {
      // Paket tek çağrıyı bile karşılamıyorsa yüklemek kullanıcıyı kandırır.
      return false;
    }
    try {
      await this.applyPurchase({
        tenantId: user.tenantId,
        userId: user.userId,
        pkg: { key: pkg.key, credits: pkg.credits, price: pkg.price, currency: pkg.currency },
        note: "OTOMATİK YÜKLEME — bakiye yetersiz kaldığı için tanımlı paket otomatik alındı.",
      });
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "KREDI_OTOMATIK_YUKLEME",
        detail: `${pkg.key} · ${pkg.credits} kredi otomatik satın alındı.`,
      });
      return true;
    } catch (err) {
      this.logger.error(`Otomatik yükleme başarısız: ${(err as Error).message}`);
      return false;
    }
  }

  /** Otomatik yükleme aç/kapat — açık kullanıcı onayı gerekir. */
  async setAutoTopUp(user: AuthUser, packageKey: string | null) {
    assertRole(user, ROLE_SETS.ONAY, "otomatik kredi yükleme ayarı");

    if (packageKey) {
      const pkg = await this.prisma.client.creditPackage.findUnique({ where: { key: packageKey } });
      if (!pkg || !pkg.isActive) {
        throw new BadRequestException(`"${packageKey}" anahtarlı satılabilir bir paket bulunamadı.`);
      }
    }
    const wallet = await this.prisma.client.creditWallet.update({
      where: { tenantId: user.tenantId },
      data: { autoTopUpPackageKey: packageKey },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "KREDI_OTOMATIK_YUKLEME_AYARI",
      detail: packageKey ? `Açıldı: ${packageKey}` : "Kapatıldı",
    });
    return {
      cuzdan: this.walletDto(wallet),
      mesaj: packageKey
        ? `Otomatik yükleme açıldı. Bakiye yetmediğinde "${packageKey}" paketi otomatik satın alınacak ve faturalandırılacaktır.`
        : "Otomatik yükleme kapatıldı. Bakiye bittiğinde yalnızca AI işlemleri durur.",
    };
  }

  // =========================================================================
  // Hareket defteri
  // =========================================================================

  async listTransactions(
    user: AuthUser,
    query: { type?: string; taskType?: string; userId?: string; from?: string; to?: string; page?: string; limit?: string },
  ) {
    assertRole(user, ROLE_SETS.ONAY, "kredi hareket dökümünü görüntüleme");

    const where: Prisma.CreditTransactionWhereInput = { tenantId: user.tenantId };
    if (query.type) where.type = query.type as Prisma.CreditTransactionWhereInput["type"];
    if (query.taskType) where.taskType = query.taskType;
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));

    const [rows, total] = await Promise.all([
      this.prisma.client.creditTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.creditTransaction.count({ where }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.client.user.findMany({
          where: { id: { in: userIds }, tenantId: user.tenantId },
          select: { id: true, fullName: true },
        })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.fullName]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        tip: r.type,
        miktar: r.amount,
        taskType: r.taskType,
        caseId: r.caseId,
        kullanici: r.userId ? nameOf.get(r.userId) ?? "(silinmiş kullanıcı)" : null,
        userId: r.userId,
        bakiyeSonrasi: r.balanceAfter,
        not: r.note,
        tarih: r.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * Dönemsel tüketim kırılımı — görev tipi ve kullanıcı bazında.
   * Kaynak hareket defteridir; AiUsageLog DEĞİL (kullanıcıya gösterilen sayı
   * tahsil edilen kredidir, token değil).
   */
  async usageBreakdown(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "kredi tüketim kırılımını görüntüleme");

    const wallet = await this.prisma.client.creditWallet.findUnique({
      where: { tenantId: user.tenantId },
    });
    const from = wallet?.periodStart ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

    const rows = await this.prisma.client.creditTransaction.findMany({
      where: { tenantId: user.tenantId, type: "TUKETIM", createdAt: { gte: from } },
      select: { amount: true, taskType: true, userId: true, createdAt: true },
    });

    const byTask = new Map<string, { kredi: number; adet: number }>();
    const byUser = new Map<string, { kredi: number; adet: number }>();
    const byDay = new Map<string, number>();

    for (const r of rows) {
      const spent = Math.abs(r.amount);
      const task = r.taskType ?? "(bilinmiyor)";
      const t = byTask.get(task) ?? { kredi: 0, adet: 0 };
      byTask.set(task, { kredi: t.kredi + spent, adet: t.adet + 1 });

      const uid = r.userId ?? "(bilinmiyor)";
      const u = byUser.get(uid) ?? { kredi: 0, adet: 0 };
      byUser.set(uid, { kredi: u.kredi + spent, adet: u.adet + 1 });

      const day = r.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + spent);
    }

    const userIds = [...byUser.keys()].filter((id) => id !== "(bilinmiyor)");
    const users = userIds.length
      ? await this.prisma.client.user.findMany({
          where: { id: { in: userIds }, tenantId: user.tenantId },
          select: { id: true, fullName: true, role: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      donemBaslangic: from,
      toplamTuketim: rows.reduce((s, r) => s + Math.abs(r.amount), 0),
      gorevTipineGore: [...byTask.entries()]
        .map(([taskType, v]) => ({ taskType, ...v }))
        .sort((a, b) => b.kredi - a.kredi),
      kullaniciyaGore: [...byUser.entries()]
        .map(([userId, v]) => ({
          userId,
          ad: userMap.get(userId)?.fullName ?? "(bilinmiyor)",
          rol: userMap.get(userId)?.role ?? null,
          ...v,
        }))
        .sort((a, b) => b.kredi - a.kredi),
      gunluk: [...byDay.entries()]
        .map(([tarih, kredi]) => ({ tarih, kredi }))
        .sort((a, b) => a.tarih.localeCompare(b.tarih)),
    };
  }

  /**
   * MUTABAKAT — hareket defteri toplamı ile cüzdan bakiyesi tutuyor mu?
   * (kabul kriteri 9). Fark varsa 0 döndürülmez; fark AÇIKÇA raporlanır.
   */
  async reconcile(tenantId: string) {
    const [wallet, agg] = await Promise.all([
      this.prisma.client.creditWallet.findUnique({ where: { tenantId } }),
      this.prisma.client.creditTransaction.aggregate({
        where: { tenantId },
        _sum: { amount: true },
      }),
    ]);
    if (!wallet) throw new NotFoundException("Kredi cüzdanı bulunamadı.");
    const ledger = agg._sum.amount ?? 0;
    const balance = settledBalance(wallet);
    return {
      hareketToplami: ledger,
      cuzdanBakiyesi: balance,
      fark: balance - ledger,
      tutarli: balance === ledger,
      rezerve: wallet.reservedCredits,
      not:
        "Rezerve krediler hareket defterine YAZILMAZ (henüz tüketilmemişlerdir); " +
        "bu yüzden mutabakat rezerve HARİÇ bakiye üzerinden yapılır.",
    };
  }

  /** Platform tarafı manuel düzeltme — dört-göz onayından SONRA çağrılır. */
  async applyManualAdjustment(input: {
    tenantId: string;
    deltaCredits: number;
    reason: string;
    actorLabel: string;
  }) {
    const wallet = await this.prisma.client.creditWallet.findUnique({
      where: { tenantId: input.tenantId },
    });
    if (!wallet) throw new NotFoundException("Bu büro için kredi cüzdanı tanımlı değil.");

    const delta = Math.trunc(input.deltaCredits);
    if (delta === 0) throw new BadRequestException("Düzeltme miktarı sıfır olamaz.");
    const rejection = adjustmentRejection(wallet, delta);
    if (rejection) throw new BadRequestException(rejection);

    return this.prisma.client.$transaction(async (tx) => {
      // ATOMİK DÜŞÜM — yukarıdaki kontrol işlem DIŞINDA okunmuş bir fotoğrafa
      // dayanır (kullanıcıya anlamlı hata verebilmek için). Gerçek koruma bu
      // koşullu `UPDATE`'tedir: iki eşzamanlı düzeltme ya da araya giren bir
      // `settle` bakiyeyi negatife düşüremez. Koşul REZERVEYİ DE sayar —
      // uçuştaki çağrılar mahsuplaştığında `purchasedCredits` negatife inerdi.
      const rows = await tx.$executeRaw`
        UPDATE "CreditWallet"
        SET "purchasedCredits" = "purchasedCredits" + ${delta}::int,
            "updatedAt" = NOW()
        WHERE "tenantId" = ${input.tenantId}
          AND ("includedCredits" - "includedConsumed") + "purchasedCredits"
              - "reservedCredits" + ${delta}::int >= 0
      `;
      if (rows === 0) {
        throw new BadRequestException(
          `${Math.abs(delta)} kredi düşülemedi: uygulama anında kullanılabilir bakiye ` +
            "yetersiz kaldı (uçuştaki çağrılar için rezerve edilmiş krediler dâhil). " +
            "Kredi bakiyesi negatife çekilemez.",
        );
      }

      const updated = await tx.creditWallet.findUniqueOrThrow({
        where: { tenantId: input.tenantId },
      });
      await tx.creditTransaction.create({
        data: {
          tenantId: input.tenantId,
          type: "DUZELTME",
          amount: delta,
          balanceAfter: settledBalance(updated),
          note: `PLATFORM DÜZELTMESİ (dört-göz onaylı, ${input.actorLabel}). Gerekçe: ${input.reason}`,
        },
      });
      return { cuzdan: this.walletDto(updated), uygulanan: delta };
    });
  }

  /**
   * AÇILIŞ YEDEKLEMESİ: cüzdansız kiracı kalmasın. Kiracı açılışı artık
   * cüzdanı aynı işlemde açar; bu yol daha önce açılmış (ya da elle/seed ile
   * yaratılmış) kiracılar içindir. İdempotent; her açılışta ucuz (kiracı sayısı).
   */
  async ensureWalletsForAllTenants(): Promise<number> {
    const [tenants, wallets] = await Promise.all([
      this.prisma.client.tenant.findMany({ select: { id: true } }),
      this.prisma.client.creditWallet.findMany({ select: { tenantId: true } }),
    ]);
    const has = new Set(wallets.map((w) => w.tenantId));
    let created = 0;
    for (const t of tenants) {
      if (has.has(t.id)) continue;
      await this.ensureWallet(t.id);
      created += 1;
    }
    return created;
  }

  /** Platform tarafı: cüzdanı olmayan tenant'a cüzdan açar. */
  async ensureWallet(tenantId: string) {
    const existing = await this.prisma.client.creditWallet.findUnique({ where: { tenantId } });
    if (existing) return existing;

    const subscription = await this.prisma.client.subscription.findUnique({ where: { tenantId } });
    const quota = planQuota(subscription?.planKey, subscription?.seats ?? 1, {
      includedCredits: 500,
      documentQuota: 200,
    });
    const period = nextPeriod(new Date());

    return this.prisma.client.$transaction(async (tx) => {
      const wallet = await tx.creditWallet.create({
        data: {
          tenantId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          includedCredits: quota.credits,
          documentQuota: quota.documents,
        },
      });
      await tx.creditTransaction.create({
        data: {
          tenantId,
          type: "TAHSIS",
          amount: quota.credits,
          balanceAfter: quota.credits,
          note: `Cüzdan açıldı. ${quota.basis}`,
        },
      });
      return wallet;
    });
  }
}
