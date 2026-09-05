import { describe, expect, it } from "vitest";
import { Prisma } from "@nomosos/db";
import {
  BYO_LLM_DISCOUNT_PERCENT,
  computePackageCharge,
  computeSubscriptionCharge,
  couponDiscount,
  couponValidity,
  nextBillingPeriod,
  periodListPrice,
  proRataDelta,
} from "./subscription-pricing";

const D = (v: string | number) => new Prisma.Decimal(v);
const BURO = { monthlyPricePerUser: D("1200.00"), annualPricePerUser: null };

describe("periodListPrice", () => {
  it("aylık = fiyat × koltuk; yıllık tanımsızsa 12 × aylık × (1 − %15); tanımlıysa yıllık × koltuk", () => {
    expect(periodListPrice(BURO, 5, "AYLIK").toFixed(2)).toBe("6000.00");
    expect(periodListPrice(BURO, 5, "YILLIK").toFixed(2)).toBe("61200.00"); // 1200*12*0.85*5
    expect(periodListPrice({ monthlyPricePerUser: "1200", annualPricePerUser: "12000" }, 2, "YILLIK").toFixed(2)).toBe("24000.00");
    expect(periodListPrice({ monthlyPricePerUser: null }, 3, "AYLIK").toFixed(2)).toBe("0.00");
    expect(periodListPrice(BURO, 0, "AYLIK").toFixed(2)).toBe("1200.00"); // en az 1 koltuk
  });
});

describe("couponDiscount", () => {
  it("yüzde ve sabit; tutarı aşamaz", () => {
    expect(couponDiscount(D(1000), { code: "X", kind: "YUZDE", value: 25 }).toFixed(2)).toBe("250.00");
    expect(couponDiscount(D(1000), { code: "X", kind: "SABIT", value: "300" }).toFixed(2)).toBe("300.00");
    expect(couponDiscount(D(100), { code: "X", kind: "SABIT", value: 300 }).toFixed(2)).toBe("100.00");
    expect(couponDiscount(D(100), null).toFixed(2)).toBe("0.00");
  });
});

describe("computeSubscriptionCharge", () => {
  it("indirimsiz: KDV %20", () => {
    const c = computeSubscriptionCharge({ plan: BURO, seats: 5, interval: "AYLIK" });
    expect(c.listAmount.toFixed(2)).toBe("6000.00");
    expect(c.discountAmount.toFixed(2)).toBe("0.00");
    expect(c.vatAmount.toFixed(2)).toBe("1200.00");
    expect(c.total.toFixed(2)).toBe("7200.00");
    expect(c.discountReason).toBeNull();
  });

  it("BYO-LLM %30 otomatik; kuponla birleşmez — büyük olan uygulanır", () => {
    const byo = computeSubscriptionCharge({ plan: BURO, seats: 5, interval: "AYLIK", byoActive: true });
    expect(byo.discountAmount.toFixed(2)).toBe("1800.00");
    expect(byo.discountReason).toContain(`%${BYO_LLM_DISCOUNT_PERCENT}`);
    expect(byo.couponCode).toBeNull();
    expect(byo.total.toFixed(2)).toBe("5040.00"); // (6000-1800)*1.2

    const both = computeSubscriptionCharge({ plan: BURO, seats: 5, interval: "AYLIK", byoActive: true, coupon: { code: "K10", kind: "YUZDE", value: 10 } });
    expect(both.discountAmount.toFixed(2)).toBe("1800.00"); // BYO > kupon
    expect(both.couponCode).toBeNull();

    const bigCoupon = computeSubscriptionCharge({ plan: BURO, seats: 5, interval: "AYLIK", byoActive: true, coupon: { code: "K50", kind: "YUZDE", value: 50 } });
    expect(bigCoupon.discountAmount.toFixed(2)).toBe("3000.00");
    expect(bigCoupon.couponCode).toBe("K50");
  });

  it("kredi paketi: kupon uygulanır, BYO uygulanmaz", () => {
    const c = computePackageCharge("400.00", { code: "KREDI20", kind: "YUZDE", value: 20 });
    expect(c.amount.toFixed(2)).toBe("320.00");
    expect(c.total.toFixed(2)).toBe("384.00");
    expect(c.couponCode).toBe("KREDI20");
    expect(computePackageCharge("400.00").total.toFixed(2)).toBe("480.00");
  });
});

describe("proRataDelta", () => {
  const periodStart = new Date("2026-09-01T00:00:00Z");
  const periodEnd = new Date("2026-10-01T00:00:00Z");
  it("kalan gün oranında pozitif fark; düşürmede null; dönem sonunda null", () => {
    const d = proRataDelta({ oldPeriodPrice: D(3000), newPeriodPrice: D(6000), periodStart, periodEnd, now: new Date("2026-09-16T00:00:00Z") });
    expect(d).toEqual({ amount: D("1500.00"), remainingDays: 15, totalDays: 30 });
    expect(proRataDelta({ oldPeriodPrice: D(6000), newPeriodPrice: D(3000), periodStart, periodEnd, now: new Date("2026-09-16T00:00:00Z") })).toBeNull();
    expect(proRataDelta({ oldPeriodPrice: D(3000), newPeriodPrice: D(6000), periodStart, periodEnd, now: periodEnd })).toBeNull();
  });
});

describe("nextBillingPeriod / couponValidity", () => {
  it("aylık +1 ay, yıllık +1 yıl; kupon geçerlilik kuralları", () => {
    const from = new Date("2026-01-31T00:00:00Z");
    expect(nextBillingPeriod(from, "AYLIK").periodEnd.toISOString()).toBe("2026-03-03T00:00:00.000Z"); // JS ay taşması: 31 Şub → 3 Mar
    expect(nextBillingPeriod(from, "YILLIK").periodEnd.toISOString()).toBe("2027-01-31T00:00:00.000Z");
    const now = new Date("2026-09-05T00:00:00Z");
    const base = { isActive: true, appliesTo: "TUM" as const, validFrom: null, validUntil: null, maxRedemptions: null, redeemedCount: 0 };
    expect(couponValidity(base, "ABONELIK", now)).toEqual({ ok: true });
    expect(couponValidity({ ...base, isActive: false }, "ABONELIK", now).ok).toBe(false);
    expect(couponValidity({ ...base, appliesTo: "KREDI" }, "ABONELIK", now).ok).toBe(false);
    expect(couponValidity({ ...base, validUntil: new Date("2026-09-01T00:00:00Z") }, "KREDI", now).ok).toBe(false);
    expect(couponValidity({ ...base, validFrom: new Date("2026-10-01T00:00:00Z") }, "KREDI", now).ok).toBe(false);
    expect(couponValidity({ ...base, maxRedemptions: 2, redeemedCount: 2 }, "KREDI", now).ok).toBe(false);
  });
});
