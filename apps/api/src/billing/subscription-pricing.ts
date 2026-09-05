/**
 * ABONELİK FİYATLANDIRMA — SAF HESAP (Faz 3, gelir hattı).
 *
 * Tek doğruluk kaynağı: dönem faturası, plan farkı (pro-rata) ve kupon/BYO
 * indirimi buradaki fonksiyonlarla hesaplanır; servisler yalnız veri getirir.
 * Para `Prisma.Decimal` ile taşınır; ara sonuçlar 2 haneye yuvarlanır (KDV
 * yuvarlaması resmî fatura düzeniyle uyumlu: net → indirim → KDV → toplam).
 *
 * KURALLAR
 *  - Aylık: `monthlyPricePerUser × seats`; yıllık: `annualPricePerUser × seats`
 *    (yıllık fiyat tanımsızsa 12 × aylık × (1 − YILLIK_INDIRIM)).
 *  - BYO-LLM indirimi (%30, pazarlama vaadi): büro kendi LLM sağlayıcısını
 *    kullanıyorsa ABONELİK faturasına otomatik uygulanır; kuponla BİRLEŞMEZ
 *    (büyük olan uygulanır) — çifte indirim yok.
 *  - KDV %20.
 *  - Pro-rata: dönem ortasında plan/koltuk yükseltmesinde kalan gün oranında
 *    fark faturası (PLAN_FARKI); düşürmede fark YOKTUR (iade yok, sonraki dönem
 *    yeni fiyattan) — SaaS'ta olağan ve dürüst uygulama.
 */

import { Prisma } from "@nomosos/db";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export const VAT_RATE = D("0.20");
export const BYO_LLM_DISCOUNT_PERCENT = 30;
/** Yıllık fiyat tanımlı değilse: 12 ay × aylık × (1 − %15). */
export const YILLIK_VARSAYILAN_INDIRIM_PERCENT = 15;

export type BillingInterval = "AYLIK" | "YILLIK";

export interface CouponLike {
  code: string;
  kind: "YUZDE" | "SABIT";
  value: Prisma.Decimal | string | number;
}

export interface PlanPriceLike {
  monthlyPricePerUser: Prisma.Decimal | string | number | null;
  annualPricePerUser?: Prisma.Decimal | string | number | null;
}

export interface ChargeBreakdown {
  /** İndirim öncesi liste tutarı. */
  listAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  /** İndirim gerekçesi — fatura açıklamasına yazılır. */
  discountReason: string | null;
  couponCode: string | null;
  /** İndirim sonrası net (KDV hariç). */
  amount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

export function periodListPrice(plan: PlanPriceLike, seats: number, interval: BillingInterval): Prisma.Decimal {
  const safeSeats = Math.max(1, Math.floor(seats) || 1);
  const monthly = plan.monthlyPricePerUser === null || plan.monthlyPricePerUser === undefined ? D(0) : D(plan.monthlyPricePerUser);
  if (interval === "AYLIK") return monthly.mul(safeSeats).toDecimalPlaces(2);
  if (plan.annualPricePerUser !== null && plan.annualPricePerUser !== undefined) {
    return D(plan.annualPricePerUser).mul(safeSeats).toDecimalPlaces(2);
  }
  return monthly
    .mul(12)
    .mul(D(100 - YILLIK_VARSAYILAN_INDIRIM_PERCENT).div(100))
    .mul(safeSeats)
    .toDecimalPlaces(2);
}

/** Kupon indirimi (tutarı aşamaz). */
export function couponDiscount(listAmount: Prisma.Decimal, coupon: CouponLike | null | undefined): Prisma.Decimal {
  if (!coupon) return D(0);
  const value = D(coupon.value);
  const raw = coupon.kind === "YUZDE" ? listAmount.mul(value).div(100) : value;
  const capped = raw.gt(listAmount) ? listAmount : raw;
  return capped.lt(0) ? D(0) : capped.toDecimalPlaces(2);
}

export function applyVat(amount: Prisma.Decimal): { vatAmount: Prisma.Decimal; total: Prisma.Decimal } {
  const vatAmount = amount.mul(VAT_RATE).toDecimalPlaces(2);
  return { vatAmount, total: amount.add(vatAmount) };
}

/**
 * Dönem faturası kırılımı. `byoActive` = büro kendi LLM sağlayıcısıyla çalışıyor
 * (pazarlama vaadi: %30). Kupon ve BYO birlikte geçerliyse BÜYÜK indirim uygulanır.
 */
export function computeSubscriptionCharge(input: {
  plan: PlanPriceLike;
  seats: number;
  interval: BillingInterval;
  coupon?: CouponLike | null;
  byoActive?: boolean;
}): ChargeBreakdown {
  const listAmount = periodListPrice(input.plan, input.seats, input.interval);
  const fromCoupon = couponDiscount(listAmount, input.coupon);
  const fromByo = input.byoActive ? listAmount.mul(BYO_LLM_DISCOUNT_PERCENT).div(100).toDecimalPlaces(2) : D(0);

  let discountAmount = D(0);
  let discountReason: string | null = null;
  let couponCode: string | null = null;
  if (fromByo.gt(0) && fromByo.gte(fromCoupon)) {
    discountAmount = fromByo;
    discountReason = `BYO-LLM indirimi %${BYO_LLM_DISCOUNT_PERCENT} (büro kendi AI sağlayıcısını kullanıyor)`;
  } else if (fromCoupon.gt(0) && input.coupon) {
    discountAmount = fromCoupon;
    couponCode = input.coupon.code;
    discountReason =
      input.coupon.kind === "YUZDE"
        ? `Kupon ${input.coupon.code}: %${D(input.coupon.value).toFixed(0)}`
        : `Kupon ${input.coupon.code}: ${D(input.coupon.value).toFixed(2)} TRY`;
  }
  const amount = listAmount.sub(discountAmount).toDecimalPlaces(2);
  const { vatAmount, total } = applyVat(amount);
  return { listAmount, discountAmount, discountReason, couponCode, amount, vatAmount, total };
}

/** Kredi paketi: kupon (KREDI/TUM kapsamı) uygulanır, BYO uygulanmaz. */
export function computePackageCharge(price: Prisma.Decimal | string | number, coupon?: CouponLike | null): ChargeBreakdown {
  const listAmount = D(price).toDecimalPlaces(2);
  const discountAmount = couponDiscount(listAmount, coupon);
  const amount = listAmount.sub(discountAmount);
  const { vatAmount, total } = applyVat(amount);
  return {
    listAmount,
    discountAmount,
    discountReason: discountAmount.gt(0) && coupon ? `Kupon ${coupon.code}` : null,
    couponCode: discountAmount.gt(0) && coupon ? coupon.code : null,
    amount,
    vatAmount,
    total,
  };
}

/**
 * Pro-rata plan farkı: dönemin kalan günleri oranında (yeni dönem fiyatı − eski dönem
 * fiyatı). Negatif ya da sıfır → null (fark faturası yok).
 */
export function proRataDelta(input: {
  oldPeriodPrice: Prisma.Decimal;
  newPeriodPrice: Prisma.Decimal;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}): { amount: Prisma.Decimal; remainingDays: number; totalDays: number } | null {
  const day = 86_400_000;
  const totalDays = Math.max(1, Math.round((input.periodEnd.getTime() - input.periodStart.getTime()) / day));
  const remainingDays = Math.max(0, Math.min(totalDays, Math.ceil((input.periodEnd.getTime() - input.now.getTime()) / day)));
  if (remainingDays === 0) return null;
  const diff = input.newPeriodPrice.sub(input.oldPeriodPrice);
  if (diff.lte(0)) return null;
  const amount = diff.mul(remainingDays).div(totalDays).toDecimalPlaces(2);
  if (amount.lte(0)) return null;
  return { amount, remainingDays, totalDays };
}

/** Bir sonraki dönem sınırları (aylık: +1 ay, yıllık: +1 yıl; UTC gün başı korunur). */
export function nextBillingPeriod(from: Date, interval: BillingInterval): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(from);
  const periodEnd = new Date(from);
  if (interval === "YILLIK") periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
  else periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  return { periodStart, periodEnd };
}

/** Kupon şu an ve bu kapsam için geçerli mi? Değilse Türkçe gerekçe. */
export function couponValidity(
  c: {
    isActive: boolean;
    appliesTo: "TUM" | "ABONELIK" | "KREDI";
    validFrom: Date | null;
    validUntil: Date | null;
    maxRedemptions: number | null;
    redeemedCount: number;
  },
  scope: "ABONELIK" | "KREDI",
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (!c.isActive) return { ok: false, reason: "Kupon devre dışı." };
  if (c.appliesTo !== "TUM" && c.appliesTo !== scope) {
    return { ok: false, reason: scope === "ABONELIK" ? "Kupon abonelik için geçerli değil." : "Kupon kredi paketi için geçerli değil." };
  }
  if (c.validFrom && c.validFrom.getTime() > now.getTime()) return { ok: false, reason: "Kupon henüz başlamadı." };
  if (c.validUntil && c.validUntil.getTime() < now.getTime()) return { ok: false, reason: "Kuponun süresi dolmuş." };
  if (c.maxRedemptions !== null && c.redeemedCount >= c.maxRedemptions) return { ok: false, reason: "Kupon kullanım sınırına ulaştı." };
  return { ok: true };
}
