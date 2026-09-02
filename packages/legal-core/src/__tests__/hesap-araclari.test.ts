/**
 * A3 HESAP MOTORLARI TESTLERİ — kıdem/ihbar, faiz, harç.
 *
 * Kıdem/ihbar: bilinen senaryolarda elle doğrulanmış değerler.
 * Faiz: 3095 basit faiz formülü.
 * Harç: binde oranı tamsapenny aritmetiği.
 */

import { describe, expect, it } from "vitest";
import { calculateKidemIhbar } from "../kidem-ihbar";
import { calculateSimpleInterest } from "../faiz";
import { calculateDavaHarci } from "../harc";

describe("kıdem/ihbar tazminatı", () => {
  it("4 yıl tam kıdem: 120 gün kıdem tazminatı", () => {
    const r = calculateKidemIhbar({
      monthlyGross: 30000,
      startDate: "2021-01-15",
      endDate: "2025-01-15",
      includeNotice: false,
    });
    expect(r.fullYears).toBe(4);
    expect(r.kidemDays).toBe(120);
    // 30000 / 30 = 1000 TL/gün × 120 = 120.000 TL.
    expect(r.kidemTazminat).toBe(120000);
    expect(r.ceilingApplied).toBe(false);
  });

  it("tavan aşımı: tavan esas alınır", () => {
    const r = calculateKidemIhbar({
      monthlyGross: 50000,
      startDate: "2020-01-01",
      endDate: "2025-01-01",
      ceiling: 30000,
      includeNotice: false,
    });
    expect(r.ceilingApplied).toBe(true);
    // 30000/30 = 1000 × 150 gün = 150.000.
    expect(r.kidemTazminat).toBe(150000);
  });

  it("ihbar: 5 ay kıdem → 2 hafta değil 4 hafta (m.17 aralıkları)", () => {
    // İş K. m.17: 0–6 ay = 2 hafta; 6 ay–1,5 yıl = 4; 1,5–3 yıl = 6; 3+ yıl = 8.
    // 2025-03-01 → 2025-08-01 = 5 ay → 2 hafta beklenir.
    const r = calculateKidemIhbar({
      monthlyGross: 30000,
      startDate: "2025-03-01",
      endDate: "2025-08-01",
    });
    expect(r.ihbarWeeks).toBe(2);
    expect(r.ihbarTazminat).not.toBeNull();
  });

  it("ihbar: 4+ yıl → 8 hafta", () => {
    const r = calculateKidemIhbar({
      monthlyGross: 30000,
      startDate: "2021-01-15",
      endDate: "2025-06-15",
    });
    expect(r.ihbarWeeks).toBe(8);
  });

  it("uyarılar kapsam dışını bildirir (tavan, işe iade, kesintiler)", () => {
    const r = calculateKidemIhbar({
      monthlyGross: 30000,
      startDate: "2021-01-15",
      endDate: "2025-01-15",
    });
    expect(r.warnings.join(" ")).toContain("tavan");
    expect(r.warnings.join(" ")).toContain("işe iade");
  });

  it("geçersiz giriş: çıkış ≤ giriş reddedilir", () => {
    expect(() =>
      calculateKidemIhbar({
        monthlyGross: 10000,
        startDate: "2025-01-01",
        endDate: "2024-01-01",
      }),
    ).toThrow();
  });
});

describe("basit faiz (3095)", () => {
  it("1 yıl %24: anaparanın %'i kadar faiz", () => {
    const r = calculateSimpleInterest({
      principal: 100000,
      fromDate: "2025-01-01",
      toDate: "2026-01-01",
      annualRatePercent: 24,
    });
    // 2025 takvim yılı 365 gün.
    expect(r.days).toBe(365);
    expect(r.interest).toBe(24000);
    expect(r.total).toBe(124000);
  });

  it("kuruş hassasiyeti: yuvarlama 2 hane", () => {
    const r = calculateSimpleInterest({
      principal: 33333.33,
      fromDate: "2025-01-01",
      toDate: "2025-04-01",
      annualRatePercent: 24.75,
    });
    expect(Number.isFinite(r.interest)).toBe(true);
    expect(Math.round(r.interest * 100) === r.interest * 100).toBe(true);
  });

  it("geçersiz dönem reddedilir", () => {
    expect(() =>
      calculateSimpleInterest({
        principal: 1000,
        fromDate: "2025-06-01",
        toDate: "2025-01-01",
        annualRatePercent: 10,
      }),
    ).toThrow();
  });
});

describe("dava harcı", () => {
  it("100.000 TL dava: binde 68,31 → 6.831,00 TL", () => {
    const r = calculateDavaHarci({ caseValue: 100000 });
    expect(r.pesinHarc).toBe(6831);
    expect(r.istinafHarc).toBe(3416);
  });

  it("oran parametresi geçerli tarife oranını yansıtır", () => {
    const r = calculateDavaHarci({ caseValue: 100000, pesinRatePerMille: 70 });
    expect(r.pesinHarc).toBe(7000);
  });

  it("uyarı: oranların yıllık değişimi belirtilir", () => {
    const r = calculateDavaHarci({ caseValue: 50000 });
    expect(r.warnings.join(" ")).toContain("teyit");
  });
});
