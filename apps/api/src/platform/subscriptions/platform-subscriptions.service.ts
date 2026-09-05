import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma as PrismaNs, type Prisma, type SubscriptionStatus } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { paged, resolvePage } from "../../common/pagination";
import { PlatformAuditService } from "../platform-audit.service";
import { PlatformApprovalsService } from "../approvals/platform-approvals.service";
import { APPROVAL_ACTIONS } from "../approvals/approval-actions";
import { money, parseJson } from "../platform-serialize";
import { canMutate } from "../platform-permissions";
import type { PlatformAuthUser } from "../platform.types";
import {
  assertTransition,
  SUBSCRIPTION_STATUS_LABELS,
  transitionNeedsApproval,
} from "./subscription-state";
import type {
  PlanPatchInput,
  PlanUpsertInput,
  SubscriptionCancelInput,
  SubscriptionChangeInput,
  SubscriptionTransitionInput,
} from "./platform-subscriptions.schemas";

/**
 * ABONELİK VE PLAN KATALOĞU.
 *
 * İKİ KURAL kodun her yerinde geçerlidir:
 *   1. Durum geçişleri yalnız durum makinesine uyar (subscription-state.ts);
 *      geçersiz geçiş 400 döner ve hiçbir yazma yapılmaz.
 *   2. Yıkıcı geçişler (SUSPENDED, CANCELED) ve plan/koltuk değişimi TEK
 *      KİŞİYLE tamamlanmaz — dört-göz kuyruğuna düşer.
 */
@Injectable()
export class PlatformSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly approvals: PlatformApprovalsService
  ) {}

  // ------------------------------------------------------------- abonelik

  async list(query: { status?: string; plan?: string; page?: string; limit?: string }) {
    const where: Prisma.SubscriptionWhereInput = {};
    if (query.status) {
      const status = query.status.toUpperCase() as SubscriptionStatus;
      if (!(status in SUBSCRIPTION_STATUS_LABELS)) {
        throw new BadRequestException(
          "Geçersiz durum süzgeci. Kabul edilenler: " +
            Object.keys(SUBSCRIPTION_STATUS_LABELS).join(", ")
        );
      }
      where.status = status;
    }
    if (query.plan) where.planKey = query.plan.toUpperCase();

    const page = resolvePage(query);
    const [rows, total] = await Promise.all([
      this.prisma.client.subscription.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.subscription.count({ where }),
    ]);

    // Platform tablolarında tenantId FK DEĞİLDİR → `include: { tenant }` yok.
    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    const [tenants, plans] = await Promise.all([
      tenantIds.length
        ? this.prisma.client.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      this.prisma.client.planTier.findMany(),
    ]);
    const tenantNames = new Map(tenants.map((t) => [t.id, t.name]));
    const planByKey = new Map(plans.map((p) => [p.key, p]));

    return paged(
      rows.map((r) => {
        const plan = planByKey.get(r.planKey);
        return {
          id: r.id,
          tenantId: r.tenantId,
          tenantName: tenantNames.get(r.tenantId) ?? "(silinmiş büro)",
          planKey: r.planKey,
          planName: plan?.name ?? null,
          // planKey FK olmadığı için plan katalogdan kalkmış olabilir:
          // bu durum sessizce gizlenmez, açıkça bildirilir.
          planMissing: !plan,
          monthlyPricePerUser: money(plan?.monthlyPricePerUser ?? null),
          status: r.status,
          statusLabel: SUBSCRIPTION_STATUS_LABELS[r.status],
          seats: r.seats,
          trialEndsAt: r.trialEndsAt,
          currentPeriodStart: r.currentPeriodStart,
          currentPeriodEnd: r.currentPeriodEnd,
          canceledAt: r.canceledAt,
          note: r.note,
        };
      }),
      total,
      page
    );
  }

  /** Plan / koltuk değişikliği — DÖRT-GÖZ (rbac: tenant.plan_change). */
  async requestChange(user: PlatformAuthUser, id: string, input: SubscriptionChangeInput) {
    const subscription = await this.prisma.client.subscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException("Abonelik bulunamadı.");

    if (input.planKey) {
      const plan = await this.prisma.client.planTier.findUnique({ where: { key: input.planKey } });
      if (!plan) throw new BadRequestException(`"${input.planKey}" anahtarlı plan bulunamadı.`);
      if (!plan.isActive) {
        throw new BadRequestException(`"${plan.name}" planı satıştan kaldırılmış.`);
      }
      if (plan.maxUsers !== null && (input.seats ?? subscription.seats) > plan.maxUsers) {
        throw new BadRequestException(
          `"${plan.name}" planı en fazla ${plan.maxUsers} kullanıcı içerir; ` +
            `${input.seats ?? subscription.seats} koltuk atanamaz.`
        );
      }
    }

    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.SUBSCRIPTION_PLAN_CHANGE,
      tenantId: subscription.tenantId,
      payload: {
        subscriptionId: id,
        planKey: input.planKey,
        seats: input.seats,
        reason: input.reason,
      },
      summary:
        `Plan ${subscription.planKey} → ${input.planKey ?? subscription.planKey}, ` +
        `koltuk ${subscription.seats} → ${input.seats ?? subscription.seats}.`,
    });
  }

  /** İptal — terminal ve yıkıcı; her koşulda dört-göz. */
  async requestCancel(user: PlatformAuthUser, id: string, input: SubscriptionCancelInput) {
    const subscription = await this.prisma.client.subscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException("Abonelik bulunamadı.");
    // Geçiş geçerliliği TALEP ANINDA da doğrulanır: uygulanamayacak bir işlem
    // için onay kuyruğunu meşgul etmenin anlamı yok.
    assertTransition(subscription.status, "CANCELED");

    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.SUBSCRIPTION_CANCEL,
      tenantId: subscription.tenantId,
      payload: { subscriptionId: id, reason: input.reason },
      summary: `Abonelik iptali (${SUBSCRIPTION_STATUS_LABELS[subscription.status]} → İptal).`,
    });
  }

  /**
   * Durum geçişi.
   *
   * Olağan operasyon geçişleri (ödeme alındı, temerrüde düştü) doğrudan
   * uygulanır; yıkıcı olanlar (askı, iptal) onay kuyruğuna düşer.
   */
  async transition(user: PlatformAuthUser, id: string, input: SubscriptionTransitionInput) {
    const subscription = await this.prisma.client.subscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException("Abonelik bulunamadı.");

    const to = input.to as SubscriptionStatus;
    assertTransition(subscription.status, to);

    if (transitionNeedsApproval(subscription.status, to)) {
      // Askıdan çıkarma, adanmış `POST /tenants/:id/activate` ucuyla AYNI
      // aksiyona yönlendirilir; iki kapı tek kurala bakar.
      const action =
        to === "CANCELED"
          ? APPROVAL_ACTIONS.SUBSCRIPTION_CANCEL
          : to === "ACTIVE"
            ? APPROVAL_ACTIONS.TENANT_ACTIVATE
            : APPROVAL_ACTIONS.TENANT_SUSPEND;
      return this.approvals.request(user, {
        action,
        tenantId: subscription.tenantId,
        payload:
          to === "CANCELED"
            ? { subscriptionId: id, reason: input.reason }
            : { tenantId: subscription.tenantId, reason: input.reason },
        summary:
          `${SUBSCRIPTION_STATUS_LABELS[subscription.status]} → ` +
          `${SUBSCRIPTION_STATUS_LABELS[to]}. Gerekçe: ${input.reason}`,
      });
    }

    const updated = await this.prisma.client.subscription.update({
      where: { id },
      data: { status: to },
    });

    await this.audit.log({
      actor: user,
      action: "SUBSCRIPTION_TRANSITION",
      entity: "Subscription",
      entityId: id,
      tenantId: subscription.tenantId,
      detail: `${subscription.status} → ${to}. Gerekçe: ${input.reason}`,
    });

    return {
      approvalRequired: false,
      id: updated.id,
      status: updated.status,
      statusLabel: SUBSCRIPTION_STATUS_LABELS[updated.status],
      message: `Abonelik durumu "${SUBSCRIPTION_STATUS_LABELS[updated.status]}" olarak güncellendi.`,
    };
  }

  // ------------------------------------------------------------ plan kataloğu

  async listPlans() {
    const plans = await this.prisma.client.planTier.findMany({ orderBy: { key: "asc" } });
    const counts = await this.prisma.client.subscription.groupBy({
      by: ["planKey"],
      _count: { _all: true },
    });
    const countByKey = new Map(counts.map((c) => [c.planKey, c._count._all]));

    return {
      items: plans.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        // Para STRING döner — JSON.stringify Decimal'i düz sayı gibi basıp
        // kuruş kaybettirmesin.
        monthlyPricePerUser: money(p.monthlyPricePerUser),
        annualPricePerUser: money(p.annualPricePerUser),
        maxUsers: p.maxUsers,
        features: parseJson<Record<string, unknown>>(p.featuresJson, {}),
        isActive: p.isActive,
        subscriptionCount: countByKey.get(p.key) ?? 0,
      })),
      note:
        "Plan fiyat değişikliği mevcut aboneleri cari dönem sonuna kadar etkilemez; " +
        "satıştan kaldırılan plan pasife çekilir, mevcut aboneler korunur.",
    };
  }

  /**
   * YENİ PLAN OLUŞTURMA — DÖRT-GÖZ (denetim bulgusu K-11).
   *
   * Eskiden burada `approvals.request` çağrısı YOKTU: fiyatlı yepyeni bir plan
   * TEK İMZAYLA yaratılabiliyordu. Oysa `patchPlan`'ın fiyat dalı onaya
   * düşüyordu ve `apps/admin` paneli aynı aksiyon için dört-göz rozetini
   * gösteriyordu — arayüz söz veriyor, API tutmuyordu. Fiyat koymanın en güçlü
   * biçimi yeni bir fiyatlı ürün yaratmaktır; iki imza ister.
   *
   * Uç artık `@ApprovalWritePermission("plan.catalog.price")` taşır ve guard
   * yapısal olarak doğrudan yazmayı engeller.
   */
  async createPlan(user: PlatformAuthUser, input: PlanUpsertInput) {
    const existing = await this.prisma.client.planTier.findUnique({ where: { key: input.key } });
    if (existing) {
      throw new BadRequestException(`"${input.key}" anahtarlı bir plan zaten var.`);
    }
    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.PLAN_CREATE,
      payload: {
        key: input.key,
        name: input.name,
        // Decimal alana STRING verilir (Number vermek kuruş kaybettirir).
        monthlyPricePerUser: input.monthlyPricePerUser ?? null,
        maxUsers: input.maxUsers ?? null,
        featuresJson: JSON.stringify(input.features),
        isActive: input.isActive,
        reason: input.reason,
      },
      summary:
        `Yeni plan: ${input.key} — ${input.name} ` +
        `(${input.monthlyPricePerUser ?? "fiyatsız"} kullanıcı/ay). Bu plan TÜM ` +
        `kiracılara satışa açılır. Gerekçe: ${input.reason}`,
    });
  }

  async patchPlan(user: PlatformAuthUser, id: string, input: PlanPatchInput) {
    const plan = await this.prisma.client.planTier.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException("Plan bulunamadı.");

    /**
     * FİYAT DEĞİŞİKLİĞİ DÖRT-GÖZE DÜŞER (denetim bulgusu 9).
     *
     * Tek bir büroya indirim (`tenant.custom_price`) iki imza isterken, TÜM
     * katalog fiyatını değiştirmek tek imza istiyordu; tek bir BILLING_ADMIN
     * platformun MRR'ını topluca düşürebiliyordu. Yetki eşiği "kaç kiracıyı ve
     * ne kadar parayı etkiliyor" ölçüsüne göre belirlenir.
     *
     * Ad / azami kullanıcı / özellik listesi / satışa açıklık DOĞRUDAN kalır:
     * bunlar para değil, katalog düzeni işidir.
     */
    const priceChanges =
      input.monthlyPricePerUser !== undefined &&
      normalizePrice(input.monthlyPricePerUser) !== normalizePrice(plan.monthlyPricePerUser);

    if (priceChanges) {
      // denetim bulgusu K-11: fiyat kararının kendi matris satırı var.
      if (!canMutate(user.role, "plan.catalog.price")) {
        throw new ForbiddenException(
          "Rolünüz katalog fiyatını değiştiremez; bu işlem dört-göz onayına tabidir."
        );
      }
      // `reason` bir alan değil, talebin gerekçesidir (denetim bulgusu K-11).
      const otherFields = Object.keys(input).filter(
        (k) =>
          k !== "monthlyPricePerUser" &&
          k !== "annualPricePerUser" &&
          k !== "reason" &&
          input[k as keyof PlanPatchInput] !== undefined
      );
      if (otherFields.length > 0) {
        throw new BadRequestException(
          "Fiyat değişikliği dört-göz onayına tabidir ve aynı istekte başka alanlarla " +
            `birlikte gönderilemez (${otherFields.join(", ")}). Fiyatı ayrı bir istekte ` +
            "değiştirin; diğer alanlar doğrudan uygulanır."
        );
      }
      return this.approvals.request(user, {
        action: APPROVAL_ACTIONS.PLAN_PRICE_CHANGE,
        payload: {
          planId: plan.id,
          monthlyPricePerUser: input.monthlyPricePerUser ?? null,
          reason: input.reason ?? `${plan.key} planı fiyat değişikliği`,
        },
        summary:
          `${plan.key}: ${money(plan.monthlyPricePerUser) ?? "-"} → ` +
          `${input.monthlyPricePerUser ?? "-"} (kullanıcı/ay). Bu değişiklik plandaki ` +
          "TÜM aboneleri etkiler.",
      });
    }

    const data: Prisma.PlanTierUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.annualPricePerUser !== undefined) data.annualPricePerUser = input.annualPricePerUser ?? null;
    if (input.maxUsers !== undefined) data.maxUsers = input.maxUsers ?? null;
    if (input.features !== undefined) data.featuresJson = JSON.stringify(input.features);
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const updated = await this.prisma.client.planTier.update({ where: { id }, data });
    await this.audit.log({
      actor: user,
      action: "PLAN_UPDATE",
      entity: "PlanTier",
      entityId: id,
      detail:
        `${plan.key} planı güncellendi (fiyat DIŞI alanlar). Fiyat değişmedi: ` +
        `${money(updated.monthlyPricePerUser) ?? "-"}.`,
    });
    return { id: updated.id, key: updated.key };
  }
}

/**
 * Fiyat karşılaştırması için normalizasyon.
 *
 * Decimal ile string'i doğrudan karşılaştırmak "20" ile "20.00" farkını
 * değişiklik sanır ve gereksiz onay talebi açardı. `null` (fiyatsız plan) ayrı
 * bir durumdur ve "0" ile karıştırılmaz.
 */
function normalizePrice(value: Prisma.Decimal | string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return typeof value === "string" ? new PrismaNs.Decimal(value).toFixed(2) : value.toFixed(2);
}
