/**
 * ABONELİK FATURASI (Faz 3) — dönem faturası üretimi, plan farkı, büro özeti.
 *
 * Dönem faturası `[tenantId, type, periodStart]` tekil indeksiyle korunur:
 * iki eşzamanlı koşu ikinci üretimde P2002 alır ve "zaten var" olarak döner.
 * Fatura KESİLMİŞ (GONDERILDI, numaralı) doğar; ödeme `PlatformCheckoutService`
 * ile kesinleşir → ODENDI + abonelik dönemi ilerler.
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type InvoiceRecord, type PlanTier, type Subscription } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { CouponService } from "./coupon.service";
import {
  BYO_LLM_DISCOUNT_PERCENT,
  computeSubscriptionCharge,
  nextBillingPeriod,
  periodListPrice,
  proRataDelta,
  type BillingInterval,
} from "../billing/subscription-pricing";
import { isUniqueViolation, nextPlatformInvoiceNumber } from "./platform-invoice-number";
import { odemeSaglayiciTuru } from "../billing/odeme-saglayici";

/** Dönem faturası ödeme vadesi (gün) — dönem başlangıcından itibaren. */
export const INVOICE_DUE_DAYS = 7;
/** Dönem bitmeden kaç gün önce fatura kesilir. */
export const INVOICE_LEAD_DAYS = 7;

export function invoiceRecordDto(r: InvoiceRecord & { payments?: Array<{ status: string; paidAt: Date | null; method: string | null; providerRef: string | null }> }) {
  let meta: Record<string, unknown> = {};
  try {
    meta = r.metaJson ? (JSON.parse(r.metaJson) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }
  return {
    id: r.id,
    number: r.number,
    type: r.type,
    description: r.description,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    listAmount: r.amount.add(r.discountAmount).toFixed(2),
    discountAmount: r.discountAmount.toFixed(2),
    couponCode: r.couponCode,
    amount: r.amount.toFixed(2),
    vatAmount: r.vatAmount.toFixed(2),
    total: r.total.toFixed(2),
    currency: "TRY",
    issueDate: r.issueDate,
    dueDate: r.dueDate,
    paidAt: r.paidAt,
    status: r.status,
    odenebilir: r.status === "GONDERILDI" || r.status === "TASLAK" || r.status === "KISMI_ODENDI",
    meta,
    payments: (r.payments ?? []).map((p) => ({ status: p.status, paidAt: p.paidAt, method: p.method, providerRef: p.providerRef })),
  };
}

@Injectable()
export class SubscriptionInvoiceService {
  private readonly logger = new Logger(SubscriptionInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponService,
  ) {}

  /** Büro kendi LLM sağlayıcısını kullanıyor mu? (BYO-LLM %30 vaadi) */
  async byoActive(tenantId: string): Promise<boolean> {
    const n = await this.prisma.client.aiProviderConfig.count({ where: { tenantId, isActive: true } });
    return n > 0;
  }

  async planFor(planKey: string): Promise<PlanTier | null> {
    return this.prisma.client.planTier.findUnique({ where: { key: planKey } });
  }

  /**
   * Dönem faturası: `periodStart` = mevcut dönemin bitişi (ya da TRIAL için şimdi).
   * Zaten varsa mevcut kaydı döner (`created:false`).
   */
  async issueForPeriod(input: { subscription: Subscription; periodStart: Date; now: Date }): Promise<{ invoice: InvoiceRecord; created: boolean }> {
    const sub = input.subscription;
    const existing = await this.prisma.client.invoiceRecord.findFirst({
      where: { tenantId: sub.tenantId, type: "ABONELIK", periodStart: input.periodStart },
    });
    if (existing) return { invoice: existing, created: false };

    const plan = await this.planFor(sub.planKey);
    if (!plan) throw new BadRequestException(`"${sub.planKey}" planı bulunamadı; fatura kesilemez.`);
    if (plan.monthlyPricePerUser === null && plan.annualPricePerUser === null) {
      throw new BadRequestException(`"${plan.name}" planının fiyatı tanımlı değil; fatura kesilemez.`);
    }
    const interval = sub.billingInterval as BillingInterval;
    const { periodEnd } = nextBillingPeriod(input.periodStart, interval);
    const [coupon, byo] = await Promise.all([this.coupons.findValid(sub.couponCode, "ABONELIK", input.now), this.byoActive(sub.tenantId)]);
    const charge = computeSubscriptionCharge({ plan, seats: sub.seats, interval, coupon, byoActive: byo });
    const dueDate = new Date(input.periodStart.getTime() + INVOICE_DUE_DAYS * 86_400_000);
    const description =
      `${plan.name} planı · ${sub.seats} kullanıcı · ${interval === "YILLIK" ? "yıllık" : "aylık"} dönem ` +
      `${input.periodStart.toISOString().slice(0, 10)} – ${periodEnd.toISOString().slice(0, 10)}` +
      (charge.discountReason ? ` · ${charge.discountReason}` : "");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const invoice = await this.prisma.client.$transaction(async (tx) => {
          const number = await nextPlatformInvoiceNumber(tx, input.now.getUTCFullYear());
          return tx.invoiceRecord.create({
            data: {
              tenantId: sub.tenantId,
              type: "ABONELIK",
              number,
              description,
              periodStart: input.periodStart,
              periodEnd,
              amount: charge.amount,
              discountAmount: charge.discountAmount,
              couponCode: charge.couponCode,
              vatAmount: charge.vatAmount,
              total: charge.total,
              issueDate: input.now,
              dueDate,
              status: "GONDERILDI",
              metaJson: JSON.stringify({
                planKey: plan.key,
                seats: sub.seats,
                interval,
                listAmount: charge.listAmount.toFixed(2),
                discountReason: charge.discountReason,
                byoDiscountPercent: byo ? BYO_LLM_DISCOUNT_PERCENT : 0,
              }),
            },
          });
        });
        return { invoice, created: true };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Numara yarışı ya da dönem yarışı: dönem faturası bu arada oluştuysa onu döndür.
        const again = await this.prisma.client.invoiceRecord.findFirst({
          where: { tenantId: sub.tenantId, type: "ABONELIK", periodStart: input.periodStart },
        });
        if (again) return { invoice: again, created: false };
      }
    }
    throw new BadRequestException("Fatura numarası üretilemedi; tekrar deneyin.");
  }

  /**
   * Plan/koltuk yükseltmesi — kalan gün oranında fark faturası (PLAN_FARKI).
   * Düşürmede fark yoktur; null döner.
   */
  async issueProRata(input: {
    subscription: Subscription;
    oldPlanKey: string;
    oldSeats: number;
    newPlanKey: string;
    newSeats: number;
    now: Date;
  }): Promise<InvoiceRecord | null> {
    const sub = input.subscription;
    if (!sub.currentPeriodStart || !sub.currentPeriodEnd || sub.status !== "ACTIVE") return null;
    const [oldPlan, newPlan] = await Promise.all([this.planFor(input.oldPlanKey), this.planFor(input.newPlanKey)]);
    if (!oldPlan || !newPlan) return null;
    const interval = sub.billingInterval as BillingInterval;
    const delta = proRataDelta({
      oldPeriodPrice: periodListPrice(oldPlan, input.oldSeats, interval),
      newPeriodPrice: periodListPrice(newPlan, input.newSeats, interval),
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      now: input.now,
    });
    if (!delta) return null;
    const vatAmount = delta.amount.mul("0.20").toDecimalPlaces(2);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const number = await nextPlatformInvoiceNumber(tx, input.now.getUTCFullYear());
          return tx.invoiceRecord.create({
            data: {
              tenantId: sub.tenantId,
              type: "PLAN_FARKI",
              number,
              description:
                `Plan farkı: ${oldPlan.name} (${input.oldSeats}) → ${newPlan.name} (${input.newSeats}); ` +
                `kalan ${delta.remainingDays}/${delta.totalDays} gün oranında.`,
              periodStart: input.now,
              periodEnd: sub.currentPeriodEnd,
              amount: delta.amount,
              vatAmount,
              total: delta.amount.add(vatAmount),
              issueDate: input.now,
              dueDate: new Date(input.now.getTime() + INVOICE_DUE_DAYS * 86_400_000),
              status: "GONDERILDI",
              metaJson: JSON.stringify({ oldPlanKey: oldPlan.key, newPlanKey: newPlan.key, oldSeats: input.oldSeats, newSeats: input.newSeats, ...delta, amount: delta.amount.toFixed(2) }),
            },
          });
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    this.logger.warn(`Plan farkı faturası üretilemedi (${sub.tenantId}).`);
    return null;
  }

  async listForTenant(tenantId: string) {
    const rows = await this.prisma.client.invoiceRecord.findMany({
      where: { tenantId },
      orderBy: { issueDate: "desc" },
      take: 60,
      include: { payments: { select: { status: true, paidAt: true, method: true, providerRef: true }, orderBy: { createdAt: "desc" } } },
    });
    return { items: rows.map(invoiceRecordDto) };
  }

  async requireTenantInvoice(tenantId: string, id: string) {
    const row = await this.prisma.client.invoiceRecord.findFirst({
      where: { id, tenantId },
      include: { payments: { select: { status: true, paidAt: true, method: true, providerRef: true }, orderBy: { createdAt: "desc" } } },
    });
    if (!row) throw new NotFoundException("Fatura bulunamadı.");
    return row;
  }

  /** Ayarlar → Abonelik ekranı özeti. */
  async tenantSummary(tenantId: string, now = new Date()) {
    const sub = await this.prisma.client.subscription.findUnique({ where: { tenantId } });
    if (!sub) return { abonelik: null, plan: null, sonrakiFatura: null, acikFatura: 0, odemeSaglayici: odemeSaglayiciTuru(), byoIndirimi: false, moduller: [] as string[] };
    const plan = await this.planFor(sub.planKey);
    let modules: string[] = [];
    try {
      modules = plan ? ((JSON.parse(plan.featuresJson) as { modules?: string[] }).modules ?? []) : [];
    } catch {
      modules = [];
    }
    const interval = sub.billingInterval as BillingInterval;
    const [coupon, byo, acikFatura] = await Promise.all([
      this.coupons.findValid(sub.couponCode, "ABONELIK", now),
      this.byoActive(tenantId),
      this.prisma.client.invoiceRecord.count({ where: { tenantId, status: { in: ["GONDERILDI", "TASLAK", "KISMI_ODENDI"] } } }),
    ]);
    const charge = plan ? computeSubscriptionCharge({ plan, seats: sub.seats, interval, coupon, byoActive: byo }) : null;
    return {
      abonelik: {
        id: sub.id,
        planKey: sub.planKey,
        status: sub.status,
        seats: sub.seats,
        billingInterval: sub.billingInterval,
        couponCode: sub.couponCode,
        couponGecerli: Boolean(coupon),
        trialEndsAt: sub.trialEndsAt,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
      },
      plan: plan
        ? {
            key: plan.key,
            name: plan.name,
            monthlyPricePerUser: plan.monthlyPricePerUser?.toFixed(2) ?? null,
            annualPricePerUser: plan.annualPricePerUser?.toFixed(2) ?? null,
            maxUsers: plan.maxUsers,
          }
        : null,
      moduller: modules,
      byoIndirimi: byo,
      byoIndirimYuzdesi: BYO_LLM_DISCOUNT_PERCENT,
      sonrakiFatura: charge
        ? {
            listAmount: charge.listAmount.toFixed(2),
            discountAmount: charge.discountAmount.toFixed(2),
            discountReason: charge.discountReason,
            amount: charge.amount.toFixed(2),
            vatAmount: charge.vatAmount.toFixed(2),
            total: charge.total.toFixed(2),
            periodStart: sub.currentPeriodEnd,
          }
        : null,
      acikFatura,
      odemeSaglayici: odemeSaglayiciTuru(),
    };
  }

  /** Dönem sınırı yardımcıları (iş ve testler için). */
  static nextPeriod(from: Date, interval: BillingInterval) {
    return nextBillingPeriod(from, interval);
  }

  static isDecimal(v: unknown): v is Prisma.Decimal {
    return v instanceof Prisma.Decimal;
  }
}
