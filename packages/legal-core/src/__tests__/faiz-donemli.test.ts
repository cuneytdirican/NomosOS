import { describe, expect, it } from "vitest";
import { calculatePeriodInterest } from "../faiz";

describe("calculatePeriodInterest (Faz 6)", () => {
  it("üç dönemli avans faizi: dilimler dönem sınırında kırılır, elle hesapla birebir", () => {
    // 100.000 TL, 01.01.2026 – 01.07.2026 (181 gün); oranlar: 2025-12-01 %50, 2026-03-01 %45, 2026-06-01 %40
    const r = calculatePeriodInterest({
      principal: 100_000,
      fromDate: "2026-01-01",
      toDate: "2026-07-01",
      periods: [
        { validFrom: "2026-06-01", annualRatePercent: 40 },
        { validFrom: "2025-12-01", annualRatePercent: 50 },
        { validFrom: "2026-03-01", annualRatePercent: 45 },
      ],
    });
    expect(r.days).toBe(181);
    expect(r.segments.map((s) => [s.from, s.to, s.days, s.annualRatePercent])).toEqual([
      ["2026-01-01", "2026-03-01", 59, 50],
      ["2026-03-01", "2026-06-01", 92, 45],
      ["2026-06-01", "2026-07-01", 30, 40],
    ]);
    // 100000*0.50*59/365 = 8082.19; *0.45*92/365 = 11342.47; *0.40*30/365 = 3287.67 → 22712.33
    expect(r.segments.map((s) => s.interest)).toEqual([8082.19, 11342.47, 3287.67]);
    expect(r.interest).toBe(22712.33);
    expect(r.total).toBe(122712.33);
    expect(r.warnings).toEqual([]);
  });

  it("aralığın başında dönem yoksa o dilim faizsiz kalır ve uyarı verir; tek dönem = basit faiz", () => {
    const r = calculatePeriodInterest({ principal: 10_000, fromDate: "2026-01-01", toDate: "2026-02-01", periods: [{ validFrom: "2026-01-16", annualRatePercent: 9 }] });
    expect(r.segments[0]).toMatchObject({ days: 15, annualRatePercent: 0, interest: 0 });
    expect(r.segments[1]).toMatchObject({ days: 16, annualRatePercent: 9 });
    expect(r.warnings[0]).toContain("tanımlı faiz dönemi yok");
    const tek = calculatePeriodInterest({ principal: 10_000, fromDate: "2026-01-01", toDate: "2027-01-01", periods: [{ validFrom: "2006-01-01", annualRatePercent: 9 }] });
    expect(tek.interest).toBe(900);
  });

  it("geçersiz girdi hata verir", () => {
    expect(() => calculatePeriodInterest({ principal: 0, fromDate: "2026-01-01", toDate: "2026-02-01", periods: [] })).toThrow();
    expect(() => calculatePeriodInterest({ principal: 1, fromDate: "2026-02-01", toDate: "2026-01-01", periods: [] })).toThrow();
  });
});
