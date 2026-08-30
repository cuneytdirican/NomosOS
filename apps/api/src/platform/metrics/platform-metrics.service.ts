import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import { isAnalyst, isMasked, levelOf } from "../platform-permissions";
import { bytes, isoDay, money, Pseudonymizer, utcDay } from "../platform-serialize";
import { buildDateRange } from "../tenants/platform-tenants.service";
import type { PlatformAuthUser } from "../platform.types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** AI analitiğinde "en çok tüketen" listesinin uzunluğu. */
const TOP_TENANTS = 20;

/**
 * PLATFORM ANALİTİĞİ.
 *
 * ÜÇ İLKE:
 *
 * 1. **Panel token SAYAR, FİYATLAMAZ.** BYO-LLM gereği AI maliyeti büronun
 *    kendi sağlayıcı hesabındadır; "AI maliyeti (TL)" diye bir kolon YOKTUR
 *    ve eklenmemelidir. Bu not yanıtın içinde de döner.
 *
 * 2. **Para Decimal'dir.** MRR toplamı `Prisma.Decimal` ile yapılır; JS float
 *    ile toplanan bir gelir rakamı kuruş kaybeder ve yatırımcı raporunda
 *    mutabakatsızlık üretir. Yanıta STRING olarak çıkar.
 *
 * 3. **Kurul Raporu'nda tenant kimliği YOKTUR.** Kolon beyaz listesi
 *    (allowlist) ile üretilir: rapora yeni alan eklemek, o alanı bilinçli
 *    olarak beyaz listeye yazmayı gerektirir.
 */
@Injectable()
export class PlatformMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService
  ) {}

  // ------------------------------------------------------------- genel bakış

  async overview() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const since30 = new Date(now.getTime() - 30 * DAY_MS);

    const [
      totalTenants,
      newTenantsThisMonth,
      subscriptions,
      plans,
      aiAgg,
      failedPayments,
    ] = await Promise.all([
      this.prisma.client.tenant.count(),
      this.prisma.client.tenant.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.client.subscription.findMany({
        select: { status: true, planKey: true, seats: true, trialEndsAt: true },
      }),
      this.prisma.client.planTier.findMany(),
      this.prisma.client.aiUsageLog.aggregate({
        where: { createdAt: { gte: since30 } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.client.paymentRecord.count({ where: { status: "BASARISIZ" } }),
    ]);

    const priceByPlan = new Map(plans.map((p) => [p.key, p.monthlyPricePerUser]));
    const byStatus = new Map<string, number>();
    let mrr = new Prisma.Decimal(0);
    let trialEndingSoon = 0;

    for (const s of subscriptions) {
      byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
      if (s.status === "ACTIVE") {
        const price = priceByPlan.get(s.planKey);
        // Plan katalogdan kalkmışsa fiyat bilinmez; 0 varsaymak MRR'ı sessizce
        // düşürürdü. Bu abonelikler `mrrUnknownSubscriptions` ile ayrıca sayılır.
        if (price) mrr = mrr.plus(new Prisma.Decimal(price).mul(s.seats));
      }
      if (
        s.status === "TRIAL" &&
        s.trialEndsAt &&
        s.trialEndsAt.getTime() - now.getTime() <= 2 * DAY_MS
      ) {
        trialEndingSoon += 1;
      }
    }

    const mrrUnknown = subscriptions.filter(
      (s) => s.status === "ACTIVE" && !priceByPlan.get(s.planKey)
    ).length;

    return {
      tenants: {
        total: totalTenants,
        newThisMonth: newTenantsThisMonth,
        active: byStatus.get("ACTIVE") ?? 0,
        trial: byStatus.get("TRIAL") ?? 0,
        pastDue: byStatus.get("PAST_DUE") ?? 0,
        suspended: byStatus.get("SUSPENDED") ?? 0,
        canceled: byStatus.get("CANCELED") ?? 0,
        withoutSubscription: totalTenants - subscriptions.length,
      },
      revenue: {
        // MRR = aktif abonelik × plan fiyatı × koltuk (Decimal, KDV hariç).
        mrr: mrr.toFixed(2),
        arr: mrr.mul(12).toFixed(2),
        currency: "TRY",
        mrrUnknownSubscriptions: mrrUnknown,
      },
      attention: {
        failedPayments,
        trialEndingIn48h: trialEndingSoon,
      },
      ai: {
        windowDays: 30,
        callCount: aiAgg._count._all,
        inputTokens: aiAgg._sum.inputTokens ?? 0,
        outputTokens: aiAgg._sum.outputTokens ?? 0,
        note:
          "Panel token SAYAR, fiyatlamaz: BYO-LLM olduğu için AI maliyeti büronun kendi " +
          "sağlayıcı hesabındadır. Bu yüzden maliyet (TL) kolonu yoktur.",
      },
    };
  }

  // ------------------------------------------------------------ kullanım serisi

  async usage(query: { from?: string; to?: string; tenantId?: string }) {
    const where: Prisma.UsageSnapshotWhereInput = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    const range = buildDateRange(query);
    where.date = range ?? { gte: utcDay(new Date(Date.now() - 30 * DAY_MS)) };

    const rows = await this.prisma.client.usageSnapshot.findMany({
      where,
      orderBy: { date: "asc" },
    });

    if (query.tenantId) {
      return {
        tenantId: query.tenantId,
        // BigInt elle Number'a çevrilir; aksi hâlde JSON.stringify düşer.
        items: rows.map((s) => ({
          date: isoDay(s.date),
          activeUsers: s.activeUsers,
          caseCount: s.caseCount,
          documentCount: s.documentCount,
          aiCallCount: s.aiCallCount,
          aiInputTokens: s.aiInputTokens,
          aiOutputTokens: s.aiOutputTokens,
          storageBytes: bytes(s.storageBytes),
        })),
      };
    }

    // Tenant verilmediyse gün bazında TOPLULAŞTIRILIR.
    const byDay = new Map<
      string,
      {
        date: string;
        tenantCount: number;
        activeUsers: number;
        caseCount: number;
        documentCount: number;
        aiCallCount: number;
        aiInputTokens: number;
        aiOutputTokens: number;
        storageBytes: number;
      }
    >();
    for (const s of rows) {
      const key = isoDay(s.date);
      const acc =
        byDay.get(key) ??
        {
          date: key,
          tenantCount: 0,
          activeUsers: 0,
          caseCount: 0,
          documentCount: 0,
          aiCallCount: 0,
          aiInputTokens: 0,
          aiOutputTokens: 0,
          storageBytes: 0,
        };
      acc.tenantCount += 1;
      acc.activeUsers += s.activeUsers;
      acc.caseCount += s.caseCount;
      acc.documentCount += s.documentCount;
      acc.aiCallCount += s.aiCallCount;
      acc.aiInputTokens += s.aiInputTokens;
      acc.aiOutputTokens += s.aiOutputTokens;
      acc.storageBytes += Number(s.storageBytes ?? 0n);
      byDay.set(key, acc);
    }
    return { tenantId: null, items: [...byDay.values()] };
  }

  // ------------------------------------------------------------- AI analitiği

  /**
   * `groupBy` = tenant | taskType | provider | model.
   *
   * KVKK: prompt/yanıt gövdesi SORGUDA DAHİ yer almaz — `AiUsageLog`'dan
   * yalnız metrik kolonları okunur (spec §İş Kuralları 7). ANALYST_READONLY
   * için tenant kırılımı takma adlıdır ve `tenantId` süzgeci kapalıdır.
   */
  async ai(
    user: PlatformAuthUser,
    query: { groupBy?: string; from?: string; to?: string; tenantId?: string }
  ) {
    const groupBy = (query.groupBy ?? "taskType").toLowerCase();
    if (!["tenant", "tasktype", "provider", "model"].includes(groupBy)) {
      throw new BadRequestException(
        "groupBy yalnızca tenant, taskType, provider veya model olabilir."
      );
    }

    /**
     * TENANT KIRILIMI MATRİSE SORULUR — `tenantId` SÜZGECİNE DEĞİL.
     *
     * Uç yalnız `ai.analytics.platform` istiyordu (ANALYST için "masked" →
     * guard geçer) ve servis yalnızca `tenantId` süzgecini kapatıyordu;
     * `groupBy=tenant` açık kalmıştı. Yanıt takma adlı olduğu için kimlik
     * sızıntısı doğmuyordu, ama uç ile matris arasındaki eşleşme kopmuştu:
     * kırılıma yeni bir alan eklendiğinde ayrım SESSİZCE bozulurdu
     * (denetim bulgusu 14). Karar artık matrisin kendisinden okunur.
     */
    if (groupBy === "tenant" && levelOf(user.role, "ai.analytics.tenant") === "none") {
      throw new ForbiddenException(
        "Rolünüz AI analitiğini tenant kırılımıyla göremez (yalnız platform toplamı). " +
          "groupBy=taskType, provider ya da model kullanın."
      );
    }

    if (query.tenantId && isAnalyst(user.role)) {
      // Matris: ai.analytics.tenant → ANALYST_READONLY için "none".
      throw new ForbiddenException(
        "Analist (salt-okur) rolü tenant kırılımlı AI analitiği göremez."
      );
    }

    const where: Prisma.AiUsageLogWhereInput = {};
    const range = buildDateRange(query);
    where.createdAt = range ?? { gte: new Date(Date.now() - 30 * DAY_MS) };
    if (query.tenantId) where.tenantId = query.tenantId;

    const note =
      "Panel TOKEN SAYAR, FİYATLAMAZ. BYO-LLM modelinde AI maliyeti büronun kendi " +
      "sağlayıcı hesabındadır; bu yüzden yanıtta maliyet alanı yoktur. Prompt ve yanıt " +
      "gövdeleri hiçbir sorguda okunmaz.";

    if (groupBy === "provider") {
      // AiUsageLog'da providerType kolonu yoktur; sağlayıcı tipi
      // AiProviderConfig üzerinden çözülür (ayrı sorgu + birleştirme).
      const rows = await this.prisma.client.aiUsageLog.groupBy({
        by: ["providerConfigId"],
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      });
      const ids = rows.map((r) => r.providerConfigId).filter((v): v is string => Boolean(v));
      const configs = ids.length
        ? await this.prisma.client.aiProviderConfig.findMany({
            where: { id: { in: ids } },
            select: { id: true, type: true },
          })
        : [];
      const typeById = new Map(configs.map((c) => [c.id, c.type as string]));

      const byType = new Map<string, { calls: number; input: number; output: number }>();
      for (const r of rows) {
        const key = r.providerConfigId ? typeById.get(r.providerConfigId) ?? "BILINMIYOR" : "BILINMIYOR";
        const acc = byType.get(key) ?? { calls: 0, input: 0, output: 0 };
        acc.calls += r._count._all;
        acc.input += r._sum.inputTokens ?? 0;
        acc.output += r._sum.outputTokens ?? 0;
        byType.set(key, acc);
      }
      return {
        groupBy: "provider",
        items: [...byType].map(([key, v]) => ({
          key,
          callCount: v.calls,
          inputTokens: v.input,
          outputTokens: v.output,
        })),
        note,
      };
    }

    const field = groupBy === "tasktype" ? "taskType" : groupBy === "model" ? "model" : "tenantId";
    const rows = await this.prisma.client.aiUsageLog.groupBy({
      by: [field as "taskType"],
      where,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    });

    if (field !== "tenantId") {
      return {
        groupBy,
        items: rows
          .map((r) => ({
            key: (r as unknown as Record<string, string>)[field],
            callCount: r._count._all,
            inputTokens: r._sum.inputTokens ?? 0,
            outputTokens: r._sum.outputTokens ?? 0,
          }))
          .sort((a, b) => b.callCount - a.callCount),
        note,
      };
    }

    // --- tenant kırılımı ---
    const tenantRows = rows as unknown as {
      tenantId: string;
      _count: { _all: number };
      _sum: { inputTokens: number | null; outputTokens: number | null };
    }[];
    const top = [...tenantRows].sort((a, b) => b._count._all - a._count._all).slice(0, TOP_TENANTS);

    const masked = isMasked(user.role, "ai.analytics.platform");
    const pseudo = new Pseudonymizer();
    const names = masked
      ? new Map<string, string>()
      : new Map(
          (
            await this.prisma.client.tenant.findMany({
              where: { id: { in: top.map((r) => r.tenantId) } },
              select: { id: true, name: true },
            })
          ).map((t) => [t.id, t.name])
        );

    await this.audit.log({
      actor: user,
      action: "AI_ANALYTICS_VIEW",
      entity: "AiUsageLog",
      tenantId: query.tenantId ?? null,
      detail: `AI analitiği (${groupBy}) görüntülendi${masked ? " — takma adlı" : ""}.`,
    });

    return {
      groupBy: "tenant",
      masked,
      items: top.map((r) => ({
        // Maskeli görünümde gerçek tenantId DÖNMEZ; takma ad her yanıtta
        // yeniden üretilir, tersine eşlenemez.
        key: masked ? pseudo.alias(r.tenantId) : r.tenantId,
        name: masked ? null : names.get(r.tenantId) ?? "(silinmiş büro)",
        callCount: r._count._all,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
      })),
      note,
    };
  }

  // ---------------------------------------------------------- Kurul Raporu

  /**
   * YATIRIMCI / KURUL RAPORU.
   *
   * KOLON BEYAZ LİSTESİ: bu yanıt yalnız aşağıdaki toplulaştırılmış alanları
   * içerir. Büro adı, kullanıcı e-postası, TCKN/telefon/IBAN türü hiçbir PII,
   * tekil ödeme kaydı ve denetim izi BU YANITTA BULUNMAZ ve eklenemez
   * (spec §Güvenlik 9 + kabul kriteri 3).
   */
  async investor(user: PlatformAuthUser) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const since1 = new Date(now.getTime() - DAY_MS);

    const [subscriptions, plans, tenantTotal, newTenants, aiAgg, dau, wau, funnel] =
      await Promise.all([
        this.prisma.client.subscription.findMany({
          select: { status: true, planKey: true, seats: true, canceledAt: true },
        }),
        this.prisma.client.planTier.findMany(),
        this.prisma.client.tenant.count(),
        this.prisma.client.tenant.count({ where: { createdAt: { gte: monthStart } } }),
        this.prisma.client.aiUsageLog.aggregate({
          where: { createdAt: { gte: since30 } },
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true },
        }),
        this.distinctActiveUsers(since1),
        this.distinctActiveUsers(since7),
        this.activationFunnel(),
      ]);

    const priceByPlan = new Map(plans.map((p) => [p.key, p.monthlyPricePerUser]));
    let mrr = new Prisma.Decimal(0);
    let seats = 0;
    const byPlan = new Map<string, number>();
    let active = 0;
    let trial = 0;
    let canceledLast30 = 0;

    for (const s of subscriptions) {
      if (s.status === "ACTIVE") {
        active += 1;
        seats += s.seats;
        byPlan.set(s.planKey, (byPlan.get(s.planKey) ?? 0) + 1);
        const price = priceByPlan.get(s.planKey);
        if (price) mrr = mrr.plus(new Prisma.Decimal(price).mul(s.seats));
      }
      if (s.status === "TRIAL") trial += 1;
      if (s.status === "CANCELED" && s.canceledAt && s.canceledAt >= since30) canceledLast30 += 1;
    }

    const churnBase = active + canceledLast30;
    const churnRate = churnBase === 0 ? "0.00" : new Prisma.Decimal(canceledLast30)
      .div(churnBase)
      .mul(100)
      .toFixed(2);

    await this.audit.log({
      actor: user,
      action: "ANALYST_EXPORT",
      entity: "BoardReport",
      detail:
        "Kurul (yatırımcı) rapor seti görüntülendi. Yanıt yalnız toplulaştırılmış " +
        "metrik içerir; büro kimliği ve kişisel veri içermez.",
    });

    return {
      generatedAt: now.toISOString(),
      revenue: {
        mrr: mrr.toFixed(2),
        arr: mrr.mul(12).toFixed(2),
        arpa: active === 0 ? "0.00" : mrr.div(active).toFixed(2),
        currency: "TRY",
      },
      customers: {
        totalTenants: tenantTotal,
        payingTenants: active,
        trialTenants: trial,
        newTenantsThisMonth: newTenants,
        canceledLast30Days: canceledLast30,
        logoChurnRate30d: churnRate,
        totalSeats: seats,
      },
      planDistribution: [...byPlan].map(([planKey, count]) => ({ planKey, count })),
      engagement: {
        dailyActiveUsers: dau,
        weeklyActiveUsers: wau,
      },
      activationFunnel: funnel,
      ai: {
        windowDays: 30,
        callCount: aiAgg._count._all,
        inputTokens: aiAgg._sum.inputTokens ?? 0,
        outputTokens: aiAgg._sum.outputTokens ?? 0,
      },
      privacyNote:
        "Bu rapor kolon beyaz listesiyle üretilir: büro adı, kullanıcı e-postası, TCKN/telefon/IBAN " +
        "türü kişisel veri, tekil ödeme detayı ve denetim izi HİÇBİR KOŞULDA yer almaz.",
      costNote:
        "AI hacmi token cinsindendir; parasal maliyet içermez (BYO-LLM — maliyet büronun " +
        "kendi sağlayıcı hesabındadır).",
    };
  }

  /** Elle tetiklenen günlük fotoğraf — cron Faz 6'da bağlanacak. */
  async logSnapshotRun(user: PlatformAuthUser, result: { date: string; written: number }) {
    await this.audit.log({
      actor: user,
      action: "USAGE_SNAPSHOT_RUN",
      entity: "UsageSnapshot",
      detail: `${result.date} günü için ${result.written} büro fotoğrafı güncellendi (idempotent).`,
    });
  }

  // --------------------------------------------------------------- yardımcı

  private async distinctActiveUsers(since: Date): Promise<number> {
    const rows = await this.prisma.client.auditLog.findMany({
      where: { createdAt: { gte: since }, userId: { not: null } },
      select: { userId: true },
      distinct: ["userId"],
    });
    return rows.length;
  }

  /**
   * Aktivasyon hunisi — tenant ADI TAŞIMAZ, yalnız adım sayıları.
   * Adımlar: kayıt → 2. kullanıcı → ilk müvekkil → ilk dosya →
   * AI sağlayıcı bağlama → ilk AI çağrısı.
   */
  private async activationFunnel() {
    const [tenants, users, clients, cases, providers, aiCalls] = await Promise.all([
      this.prisma.client.tenant.count(),
      this.prisma.client.user.groupBy({ by: ["tenantId"], _count: { _all: true } }),
      this.prisma.client.client.groupBy({ by: ["tenantId"], _count: { _all: true } }),
      this.prisma.client.case.groupBy({ by: ["tenantId"], _count: { _all: true } }),
      this.prisma.client.aiProviderConfig.groupBy({ by: ["tenantId"], _count: { _all: true } }),
      this.prisma.client.aiUsageLog.groupBy({ by: ["tenantId"], _count: { _all: true } }),
    ]);

    return [
      { step: "Kayıt", label: "Büro oluşturuldu", count: tenants },
      {
        step: "İkinci kullanıcı",
        label: "En az 2 kullanıcı",
        count: users.filter((u) => u._count._all >= 2).length,
      },
      { step: "İlk müvekkil", label: "En az 1 müvekkil", count: clients.length },
      { step: "İlk dosya", label: "En az 1 dosya", count: cases.length },
      { step: "AI bağlandı", label: "AI sağlayıcı tanımlı", count: providers.length },
      { step: "İlk AI çağrısı", label: "En az 1 AI çağrısı", count: aiCalls.length },
    ];
  }
}

/** Para alanlarının string dönmesini garanti eden yardımcı (dışa açık test kancası). */
export { money };
