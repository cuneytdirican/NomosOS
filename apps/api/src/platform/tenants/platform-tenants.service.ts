import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, SubscriptionStatus } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { normalizeQuery, paged, resolvePage } from "../../common/pagination";
import { PlatformAuditService } from "../platform-audit.service";
import { PlatformApprovalsService } from "../approvals/platform-approvals.service";
import { APPROVAL_ACTIONS } from "../approvals/approval-actions";
import { bytes, isoDay, maskEmail, money, parseJson } from "../platform-serialize";
import { isAnalyst } from "../platform-permissions";
import type { PlatformAuthUser } from "../platform.types";
import type {
  SupportAccessInput,
  TenantNoteInput,
  TenantStatusInput,
  TenantUpdateInput,
} from "./platform-tenants.schemas";

/** Son 30 günün AI çağrısı için pencere. */
const AI_WINDOW_DAYS = 30;

/**
 * TENANT (BÜRO) YÖNETİMİ — PANELİN EN HASSAS YÜZEYİ.
 *
 * BU SERVİS MÜVEKKİL, DOSYA VE BELGE İÇERİĞİNİ HİÇBİR KOŞULDA DÖNDÜRMEZ.
 * Yalnızca SAYAÇ ve ÜSTVERİ okunur (spec §Amaç: "panel … yalnızca sayaç,
 * metadata ve toplulaştırma görür"). `Client`, `Case`, `Document` tabloları
 * bu dosyada YALNIZCA `count()` ile sorgulanır; hiçbir satır seçilmez.
 *
 * ANALYST_READONLY için ek bir kat vardır: liste ucu satır DEĞİL, plan/durum
 * kırılımlı AGREGAT döner; detay ucu 403'tür.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly approvals: PlatformApprovalsService
  ) {}

  // ------------------------------------------------------------------ liste

  async list(
    user: PlatformAuthUser,
    query: { q?: string; plan?: string; status?: string; page?: string; limit?: string }
  ) {
    const q = normalizeQuery(query.q);

    // Abonelik süzgeçleri ayrı sorgudan geçer: platform tablolarında tenantId
    // FK DEĞİLDİR, bu yüzden `include`/nested where mümkün değildir.
    const subscriptions = await this.prisma.client.subscription.findMany({
      select: {
        id: true,
        tenantId: true,
        planKey: true,
        status: true,
        seats: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        note: true,
      },
    });
    const subByTenant = new Map(subscriptions.map((s) => [s.tenantId, s]));

    let restrictTo: Set<string> | null = null;
    if (query.plan || query.status) {
      restrictTo = new Set(
        subscriptions
          .filter(
            (s) =>
              (!query.plan || s.planKey === query.plan.toUpperCase()) &&
              (!query.status || s.status === (query.status.toUpperCase() as SubscriptionStatus))
          )
          .map((s) => s.tenantId)
      );
    }

    const where: Prisma.TenantWhereInput = {};
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (restrictTo) where.id = { in: [...restrictTo] };

    // ---- ANALİST GÖRÜNÜMÜ: satır yok, yalnız agregat ----
    if (isAnalyst(user.role)) {
      const tenantIds = new Set(
        (await this.prisma.client.tenant.findMany({ where, select: { id: true } })).map((t) => t.id)
      );
      const byPlan = new Map<string, number>();
      const byStatus = new Map<string, number>();
      for (const s of subscriptions) {
        if (!tenantIds.has(s.tenantId)) continue;
        byPlan.set(s.planKey, (byPlan.get(s.planKey) ?? 0) + 1);
        byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
      }
      return {
        masked: true,
        note:
          "Analist (salt-okur) rolü büro kimliği göremez. Bu yanıt yalnızca plan ve durum " +
          "kırılımlı toplulaştırılmış sayıları içerir; büro adı, e-posta ve müvekkil/dosya " +
          "verisi bulunmaz.",
        totalTenants: tenantIds.size,
        withoutSubscription: tenantIds.size - [...tenantIds].filter((id) => subByTenant.has(id)).length,
        byPlan: [...byPlan].map(([planKey, count]) => ({ planKey, count })),
        byStatus: [...byStatus].map(([status, count]) => ({ status, count })),
      };
    }

    const page = resolvePage(query);
    const [tenants, total] = await Promise.all([
      this.prisma.client.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        select: { id: true, name: true, aiPolicy: true, createdAt: true },
      }),
      this.prisma.client.tenant.count({ where }),
    ]);

    const ids = tenants.map((t) => t.id);
    const counts = await this.countersFor(ids);

    return paged(
      tenants.map((t) => {
        const sub = subByTenant.get(t.id);
        const c = counts.get(t.id);
        return {
          id: t.id,
          name: t.name,
          aiPolicy: t.aiPolicy,
          createdAt: t.createdAt,
          subscription: sub
            ? {
                id: sub.id,
                planKey: sub.planKey,
                status: sub.status,
                seats: sub.seats,
                trialEndsAt: sub.trialEndsAt,
                currentPeriodEnd: sub.currentPeriodEnd,
              }
            : null,
          userCount: c?.users ?? 0,
          caseCount: c?.cases ?? 0,
          documentCount: c?.documents ?? 0,
          aiCallCount30d: c?.aiCalls ?? 0,
        };
      }),
      total,
      page
    );
  }

  // ------------------------------------------------------------------ detay

  async detail(user: PlatformAuthUser, tenantId: string) {
    this.denyAnalyst(user, "büro detayı");

    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, aiPolicy: true, autoMaskConsent: true, createdAt: true },
    });
    if (!tenant) throw new NotFoundException("Büro (tenant) bulunamadı.");

    const [subscription, counts, snapshots, openGrants] = await Promise.all([
      this.prisma.client.subscription.findUnique({ where: { tenantId } }),
      this.countersFor([tenantId]),
      this.prisma.client.usageSnapshot.findMany({
        where: { tenantId },
        orderBy: { date: "desc" },
        take: 30,
      }),
      this.prisma.client.supportAccessGrant.count({
        where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);

    const plan = subscription
      ? await this.prisma.client.planTier.findUnique({ where: { key: subscription.planKey } })
      : null;

    const c = counts.get(tenantId);

    // HASSAS OKUMA: büro detayının açılması denetim izine yazılır (spec §8).
    await this.audit.log({
      actor: user,
      action: "TENANT_DETAIL_VIEW",
      entity: "Tenant",
      entityId: tenantId,
      tenantId,
      detail: `${tenant.name} büro detayı görüntülendi (yalnız üstveri ve sayaçlar).`,
    });

    return {
      tenant,
      subscription: subscription
        ? {
            id: subscription.id,
            planKey: subscription.planKey,
            status: subscription.status,
            seats: subscription.seats,
            trialEndsAt: subscription.trialEndsAt,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            canceledAt: subscription.canceledAt,
            note: subscription.note,
          }
        : null,
      plan: plan
        ? {
            key: plan.key,
            name: plan.name,
            monthlyPricePerUser: money(plan.monthlyPricePerUser),
            maxUsers: plan.maxUsers,
            features: parseJson<Record<string, unknown>>(plan.featuresJson, {}),
            isActive: plan.isActive,
          }
        : null,
      counters: {
        userCount: c?.users ?? 0,
        clientCount: c?.clients ?? 0,
        caseCount: c?.cases ?? 0,
        documentCount: c?.documents ?? 0,
        aiCallCount30d: c?.aiCalls ?? 0,
      },
      // BigInt elle çevrilir; aksi hâlde JSON.stringify TypeError atar.
      usage: snapshots.map((s) => ({
        date: isoDay(s.date),
        activeUsers: s.activeUsers,
        caseCount: s.caseCount,
        documentCount: s.documentCount,
        aiCallCount: s.aiCallCount,
        aiInputTokens: s.aiInputTokens,
        aiOutputTokens: s.aiOutputTokens,
        storageBytes: bytes(s.storageBytes),
      })),
      activeSupportGrants: openGrants,
      contentAccessNote:
        "Bu uç müvekkil, dosya ve belge İÇERİĞİ döndürmez. İçerik erişimi yalnızca süreli, " +
        "salt-okur ve PII maskeli SupportAccessGrant ile mümkündür; kullanıcı kimliğine " +
        "bürünme (impersonation) sistemde hiç yoktur.",
    };
  }

  /** Büro kullanıcılarının ÜSTVERİSİ — e-posta maskeli, içerik yok. */
  async users(user: PlatformAuthUser, tenantId: string) {
    this.denyAnalyst(user, "büro kullanıcı listesi");

    const rows = await this.prisma.client.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    await this.audit.log({
      actor: user,
      action: "TENANT_USERS_VIEW",
      entity: "Tenant",
      entityId: tenantId,
      tenantId,
      detail: `${rows.length} kullanıcı üstverisi görüntülendi (e-posta maskeli).`,
    });

    return {
      items: rows.map((r) => ({
        id: r.id,
        // KVKK: panel personeli büro çalışanının açık e-postasını görmez.
        // Maskeleme kaldırılamaz; destek kapsamında dahi maskeli kalır.
        email: maskEmail(r.email),
        fullName: r.fullName,
        role: r.role,
        isActive: r.isActive,
        createdAt: r.createdAt,
      })),
      total: rows.length,
      note: "E-posta adresleri maskelidir ve hiçbir panel rolünde açılmaz.",
    };
  }

  /**
   * AI SAĞLAYICI ÜSTVERİSİ — `encryptedApiKey` HİÇBİR BİÇİMDE DÖNMEZ.
   * Spec kabul kriteri 7: yanıt yalnız tip/model/baseUrl/`hasApiKey` içerir.
   */
  async aiConfig(user: PlatformAuthUser, tenantId: string) {
    this.denyAnalyst(user, "AI sağlayıcı yapılandırması");

    const configs = await this.prisma.client.aiProviderConfig.findMany({
      where: { tenantId },
      // `select` ile ALAN BAZLI beyaz liste: yeni bir sır alanı şemaya
      // eklendiğinde bu yanıta kendiliğinden sızmaz.
      select: {
        id: true,
        name: true,
        type: true,
        baseUrl: true,
        defaultModel: true,
        isActive: true,
        createdAt: true,
        encryptedApiKey: true,
      },
    });

    await this.audit.log({
      actor: user,
      action: "TENANT_AI_CONFIG_VIEW",
      entity: "Tenant",
      entityId: tenantId,
      tenantId,
      detail: "AI sağlayıcı üstverisi görüntülendi (anahtar gösterilmedi).",
    });

    return {
      items: configs.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        baseUrl: c.baseUrl,
        defaultModel: c.defaultModel,
        isActive: c.isActive,
        createdAt: c.createdAt,
        // Anahtarın kendisi değil, VARLIĞI bildirilir.
        hasApiKey: Boolean(c.encryptedApiKey),
      })),
      note:
        "API anahtarları hiçbir panel rolüne, maskeli biçimde dahi gösterilmez; " +
        "yalnızca anahtarın tanımlı olup olmadığı bildirilir.",
    };
  }

  /** UsageSnapshot zaman serisi. */
  async usage(user: PlatformAuthUser, tenantId: string, query: { from?: string; to?: string }) {
    this.denyAnalyst(user, "büro kullanım serisi");

    const where: Prisma.UsageSnapshotWhereInput = { tenantId };
    const range = buildDateRange(query);
    if (range) where.date = range;

    const rows = await this.prisma.client.usageSnapshot.findMany({
      where,
      orderBy: { date: "asc" },
    });
    return {
      tenantId,
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

  // --------------------------------------------------------------- mutasyon

  async update(user: PlatformAuthUser, tenantId: string, input: TenantUpdateInput) {
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException("Büro (tenant) bulunamadı.");
    if (!input.name) return { id: tenant.id, name: tenant.name, changed: false };

    const updated = await this.prisma.client.tenant.update({
      where: { id: tenantId },
      data: { name: input.name },
    });
    await this.audit.log({
      actor: user,
      action: "TENANT_UPDATE",
      entity: "Tenant",
      entityId: tenantId,
      tenantId,
      detail: `Büro adı "${tenant.name}" → "${updated.name}".`,
    });
    return { id: updated.id, name: updated.name, changed: true };
  }

  /**
   * TENANT İÇ NOTU.
   *
   * `Tenant` tablosunda `note` alanı YOKTUR (Faz 3 şeması) ve şema bu ajanın
   * sahiplik alanı değildir. Not, büronun abonelik kaydındaki `Subscription.note`
   * alanında tutulur — panelin iç notu için tasarlanmış tek serbest alan budur.
   * Aboneliği olmayan büroya not yazılamaz (bilinçli kısıt).
   */
  async setNote(user: PlatformAuthUser, tenantId: string, input: TenantNoteInput) {
    const subscription = await this.prisma.client.subscription.findUnique({ where: { tenantId } });
    if (!subscription) {
      throw new NotFoundException(
        "Bu büronun abonelik kaydı yok; iç not abonelik kaydında tutulduğu için yazılamadı."
      );
    }
    await this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: { note: input.note },
    });
    await this.audit.log({
      actor: user,
      action: "TENANT_NOTE_UPDATE",
      entity: "Subscription",
      entityId: subscription.id,
      tenantId,
      detail: input.note ? `İç not güncellendi (${input.note.length} karakter).` : "İç not silindi.",
    });
    return { tenantId, note: input.note };
  }

  /** ASKIYA ALMA — doğrudan yapılmaz, dört-göz talebi üretir. */
  async requestSuspend(user: PlatformAuthUser, tenantId: string, input: TenantStatusInput) {
    const tenant = await this.assertTenant(tenantId);
    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.TENANT_SUSPEND,
      tenantId,
      payload: { tenantId, reason: input.reason },
      summary: `Büro: ${tenant.name}. Gerekçe: ${input.reason}`,
    });
  }

  /** AKTİFLEŞTİRME — askıya almanın simetriği; o da dört-göz kuyruğundan geçer. */
  async requestActivate(user: PlatformAuthUser, tenantId: string, input: TenantStatusInput) {
    const tenant = await this.assertTenant(tenantId);
    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.TENANT_ACTIVATE,
      tenantId,
      payload: { tenantId, reason: input.reason },
      summary: `Büro: ${tenant.name}. Gerekçe: ${input.reason}`,
    });
  }

  /**
   * DESTEK ERİŞİM PENCERESİ TALEBİ.
   *
   * Pencere burada AÇILMAZ: `rbac.ts` `support_grant.request` seviyesini
   * dört-göz olarak tanımlar (spec dört-göz listesi #5). Onay geldiğinde
   * SupportAccessGrant executor tarafından oluşturulur ve çift taraflı
   * (platform + büro) denetim kaydı yazılır.
   */
  /**
   * KALICI SİLME TALEBİ — DÖRT-GÖZ (denetim bulgusu Ö-28).
   *
   * Spec dört-göz listesinin 1. maddesi kodda hiç yoktu, çünkü uç de yoktu:
   * `DELETE /tenants/:id` mevcut değildi ve KVKK veri özne haklarının imha
   * ayağı uygulanmamıştı. İşlem GERİ ALINAMAZ olduğu için burada yalnız
   * TALEP açılır; imha, ikinci imzadan sonra executor'da yürütülür.
   */
  async requestDelete(
    user: PlatformAuthUser,
    id: string,
    input: { confirmName: string; reason: string }
  ) {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!tenant) throw new NotFoundException("Büro bulunamadı.");
    if (tenant.name.trim() !== input.confirmName.trim()) {
      throw new BadRequestException(
        `Doğrulama başarısız: büronun adı "${tenant.name}". Kalıcı silme talebi ` +
          "açmak için adı birebir yazın."
      );
    }
    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.TENANT_DELETE,
      tenantId: tenant.id,
      payload: { tenantId: tenant.id, confirmName: tenant.name, reason: input.reason },
      summary:
        `"${tenant.name}" bürosunun TÜM verisi kalıcı olarak silinecek. Bu işlem ` +
        `GERİ ALINAMAZ. Gerekçe: ${input.reason}`,
    });
  }

  async requestSupportAccess(
    user: PlatformAuthUser,
    tenantId: string,
    input: SupportAccessInput
  ) {
    const tenant = await this.assertTenant(tenantId);
    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.SUPPORT_ACCESS_GRANT,
      tenantId,
      payload: {
        tenantId,
        platformUserId: user.id,
        reason: input.reason,
        scope: input.scope,
        hours: input.hours,
      },
      summary:
        `Büro: ${tenant.name}. Kapsam: ${input.scope}, süre: ${input.hours} saat. ` +
        `Gerekçe: ${input.reason}`,
    });
  }

  // --------------------------------------------------------------- yardımcı

  private denyAnalyst(user: PlatformAuthUser, what: string): void {
    if (isAnalyst(user.role)) {
      throw new ForbiddenException(
        `Analist (salt-okur) rolü ${what} göremez. Bu rol yalnızca büro kimliği içermeyen ` +
          "toplulaştırılmış Kurul Raporu verisine erişir (GET /metrics/investor)."
      );
    }
  }

  private async assertTenant(tenantId: string) {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });
    if (!tenant) throw new NotFoundException("Büro (tenant) bulunamadı.");
    return tenant;
  }

  /**
   * Sayaçlar — N+1 yerine tek `groupBy` turu.
   * Yalnızca COUNT okunur; hiçbir müvekkil/dosya/belge satırı seçilmez.
   */
  private async countersFor(tenantIds: string[]) {
    const result = new Map<
      string,
      { users: number; clients: number; cases: number; documents: number; aiCalls: number }
    >();
    if (tenantIds.length === 0) return result;

    const since = new Date(Date.now() - AI_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [users, clients, cases, documents, aiCalls] = await Promise.all([
      this.prisma.client.user.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds } },
        _count: { _all: true },
      }),
      this.prisma.client.client.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds } },
        _count: { _all: true },
      }),
      this.prisma.client.case.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds } },
        _count: { _all: true },
      }),
      this.prisma.client.document.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds } },
        _count: { _all: true },
      }),
      this.prisma.client.aiUsageLog.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    const ensure = (id: string) => {
      let row = result.get(id);
      if (!row) {
        row = { users: 0, clients: 0, cases: 0, documents: 0, aiCalls: 0 };
        result.set(id, row);
      }
      return row;
    };
    for (const r of users) ensure(r.tenantId).users = r._count._all;
    for (const r of clients) ensure(r.tenantId).clients = r._count._all;
    for (const r of cases) ensure(r.tenantId).cases = r._count._all;
    for (const r of documents) ensure(r.tenantId).documents = r._count._all;
    for (const r of aiCalls) ensure(r.tenantId).aiCalls = r._count._all;
    return result;
  }
}

/** `from`/`to` sorgu parametrelerinden Prisma tarih süzgeci üretir. */
export function buildDateRange(query: { from?: string; to?: string }) {
  const filter: { gte?: Date; lte?: Date } = {};
  if (query.from) {
    const d = new Date(query.from);
    if (!Number.isNaN(d.getTime())) filter.gte = d;
  }
  if (query.to) {
    const d = new Date(query.to);
    if (!Number.isNaN(d.getTime())) filter.lte = d;
  }
  return filter.gte || filter.lte ? filter : undefined;
}
