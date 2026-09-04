/**
 * RİSK MOTORU KURALLARI — birim testleri.
 *
 * KİLİTLENEN ÜRÜN İLKESİ (Modül 17, iş kuralı 1 · kabul kriteri 3):
 * bant DAİMA deterministik kural tabanından türer. Yapay zekâ gösterilen
 * skoru oynatabilir, BANDI DEĞİŞTİREMEZ ve GENEL skoru doğrudan yazamaz.
 */

import { describe, expect, it } from "vitest";
import {
  BAND_THRESHOLDS,
  DIMENSION_WEIGHTS,
  MAX_AI_ADJUSTMENT,
  applyAiAdjustment,
  bandOf,
  clamp,
  computeGenel,
  computeHukuki,
  SCORED_DIMENSIONS,
  type RiskCaseSnapshot,
} from "./risk.rules";

describe("clamp / bandOf", () => {
  it("clamp sınırların dışına taşmaz", () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-30, 0, 100)).toBe(0);
    expect(clamp(42, 0, 100)).toBe(42);
  });

  it("bant eşikleri: <40 DUSUK, 40-69 ORTA, >=70 YUKSEK", () => {
    expect(bandOf(0)).toBe("DUSUK");
    expect(bandOf(BAND_THRESHOLDS.orta - 1)).toBe("DUSUK");
    expect(bandOf(BAND_THRESHOLDS.orta)).toBe("ORTA");
    expect(bandOf(BAND_THRESHOLDS.yuksek - 1)).toBe("ORTA");
    expect(bandOf(BAND_THRESHOLDS.yuksek)).toBe("YUKSEK");
    expect(bandOf(100)).toBe("YUKSEK");
  });
});

describe("applyAiAdjustment", () => {
  it("düzeltme ±25 ile SINIRLANIR ve kırpma raporlanır", () => {
    const out = applyAiAdjustment(50, 90);
    expect(out.applied).toBe(MAX_AI_ADJUSTMENT);
    expect(out.requested).toBe(90);
    expect(out.clamped).toBe(true);
  });

  it("negatif yönde de sınırlanır", () => {
    const out = applyAiAdjustment(50, -90);
    expect(out.applied).toBe(-MAX_AI_ADJUSTMENT);
    expect(out.clamped).toBe(true);
  });

  it("AI YOKKEN taban aynen kalır", () => {
    const out = applyAiAdjustment(37, undefined);
    expect(out.applied).toBe(0);
    expect(out.finalScore).toBe(37);
    expect(out.band).toBe("DUSUK");
  });

  it("BANT AI'DAN DEĞİL KURAL TABANINDAN türer", () => {
    // Taban 39 (DUSUK) + AI +25 → skor 64 (ORTA'ya işaret eder) ama bant DUSUK
    // kalır. Bu bir tutarsızlık değil, KORUMANIN KENDİSİDİR.
    const out = applyAiAdjustment(39, 25);
    expect(out.finalScore).toBe(64);
    expect(out.band).toBe("DUSUK");
    expect(out.bandConflictNote).not.toBeNull();
    expect(out.bandConflictNote).toContain("BANT DEĞİŞTİRİLMEDİ");
  });

  it("bant çelişkisi yoksa uyarı da yoktur", () => {
    const out = applyAiAdjustment(10, 5);
    expect(out.band).toBe("DUSUK");
    expect(out.bandConflictNote).toBeNull();
  });

  it("nihai skor 0-100 aralığının dışına ÇIKAMAZ", () => {
    expect(applyAiAdjustment(90, 25).finalScore).toBe(100);
    expect(applyAiAdjustment(5, -25).finalScore).toBe(0);
  });

  it("KIRPMA TABANI GİZLEMEZ: taban 85 + AI 25 → skor 100 ama taban hâlâ 85", () => {
    // Denetim bulgusu: taban `score - aiAdjustment` ile geri hesaplanınca
    // 100 - 25 = 75 çıkıyordu (gerçeği 85). Bu yüzden taban artık SAKLANIR.
    // Test, geri hesabın neden güvenilmez olduğunu kayda geçirir.
    const base = 85;
    const out = applyAiAdjustment(base, 25);
    expect(out.finalScore).toBe(100);
    const backComputed = clamp(out.finalScore - out.applied, 0, 100);
    expect(backComputed).toBe(75);
    expect(backComputed).not.toBe(base);
  });

  it("bozuk AI değeri (NaN) düzeltmeyi 0 sayar — skor bozulmaz", () => {
    const out = applyAiAdjustment(50, Number.NaN);
    expect(out.applied).toBe(0);
    expect(out.finalScore).toBe(50);
  });
});

describe("computeGenel", () => {
  const dims = SCORED_DIMENSIONS.map((dimension) => ({
    dimension,
    baseScore: 50,
    band: "ORTA" as const,
    signals: [],
    warnings: [],
  }));

  it("her puanlanan boyutun POZİTİF bir ağırlığı vardır", () => {
    // Ağırlıklar GÖRELİDİR (toplamları 1 değildir); `computeGenel` bunları
    // `totalWeight`e bölerek normalleştirir. Önemli olan hiçbir boyutun
    // ağırlıksız — yani GENEL skora hiç katkısız — kalmamasıdır.
    for (const dimension of SCORED_DIMENSIONS) {
      expect(DIMENSION_WEIGHTS[dimension]).toBeGreaterThan(0);
    }
  });

  it("SÜRE en ağır boyuttur — süre kaçırmak en ağır meslekî sonuçtur", () => {
    const max = Math.max(...Object.values(DIMENSION_WEIGHTS));
    expect(DIMENSION_WEIGHTS.SURE).toBe(max);
  });

  it("GENEL, boyutların KURAL TABANLARININ ağırlıklı ortalamasıdır", () => {
    const genel = computeGenel(dims, new Map());
    expect(genel.baseScore).toBe(50);
    expect(genel.band).toBe("ORTA");
  });

  it("boyutlar farklı olduğunda ağırlıklı ortalama düz ortalamadan AYRIŞIR", () => {
    const mixed = SCORED_DIMENSIONS.map((dimension) => ({
      dimension,
      // SÜRE 100, diğerleri 0 → ağırlığı en yüksek boyut sonucu yukarı çeker.
      baseScore: dimension === "SURE" ? 100 : 0,
    }));
    const genel = computeGenel(mixed, new Map());
    const totalWeight = SCORED_DIMENSIONS.reduce((s, d) => s + DIMENSION_WEIGHTS[d], 0);
    expect(genel.baseScore).toBe(Math.round((100 * DIMENSION_WEIGHTS.SURE) / totalWeight));
  });

  it("GENEL TABANI AI'DAN ETKİLENMEZ; AI katkısı AYRI alanda taşınır", () => {
    const applied = new Map(SCORED_DIMENSIONS.map((d) => [d, 25] as const));
    const genel = computeGenel(dims, applied);
    // Taban ve bant değişmez — GENEL skor AI'dan ayrıca İSTENMEZ ve doğrudan
    // yazılamaz; düzeltme yalnız gösterilen skoru oynatır.
    expect(genel.baseScore).toBe(50);
    expect(genel.band).toBe(bandOf(50));
    expect(genel.aiAdjustment).toBe(25);
  });

  it("GENEL'deki AI katkısı da ±25 ile sınırlıdır", () => {
    const applied = new Map(SCORED_DIMENSIONS.map((d) => [d, 999] as const));
    expect(computeGenel(dims, applied).aiAdjustment).toBe(MAX_AI_ADJUSTMENT);
  });

  it("boyut listesi boşsa çökmez, 0/DUSUK döner", () => {
    const genel = computeGenel([], new Map());
    expect(genel.baseScore).toBe(0);
    expect(genel.band).toBe("DUSUK");
  });
});

describe("HEPO müvekkil uyum sinyali (HUKUKİ boyutu)", () => {
  /** Boş anlık görüntü — yalnız hepo alanı teste göre değişir. */
  function snapshotWith(hepo: RiskCaseSnapshot["hepo"]): RiskCaseSnapshot {
    const now = new Date("2026-09-01T09:00:00.000Z");
    return {
      now,
      kase: { id: "c1", type: "DAVA", status: "ACIK", openedAt: now, lastActivityAt: now, responsibleUserId: null },
      deadlines: [],
      hearings: [],
      documents: [],
      timelineEventDates: [],
      decisions: [],
      powerOfAttorneyCount: 0,
      parties: [],
      caseLawRefs: [],
      unverifiedCitationCount: 0,
      claims: [],
      evidences: [],
      enforcement: { exists: false, hasOpenObjection: false, objectionActionCount: 0, latestCollectionScore: null },
      finance: { billed: "0", collected: "0", hasFeeAgreement: false },
      strategy: { exists: false, status: null, weakPointCount: 0, riskNodeCount: 0 },
      recentLossFindingCount: 0,
      hepo,
    };
  }

  function hepoSignal(hepo: RiskCaseSnapshot["hepo"]) {
    const dim = computeHukuki(snapshotWith(hepo));
    return dim.signals.find((s) => s.key === "HEPO_CLIENT_OVERDUE");
  }

  it("vadesi geçmiş her yükümlülük 10 puan; azami 20", () => {
    expect(hepoSignal({ clientHasAssignments: true, overdueOpenCount: 1 })?.contribution).toBe(10);
    expect(hepoSignal({ clientHasAssignments: true, overdueOpenCount: 2 })?.contribution).toBe(20);
    expect(hepoSignal({ clientHasAssignments: true, overdueOpenCount: 5 })?.contribution).toBe(20);
  });

  it("uyumlu müvekkil ve hiç atanmamış müvekkil puan ÜRETMEZ", () => {
    expect(hepoSignal({ clientHasAssignments: true, overdueOpenCount: 0 })?.contribution).toBe(0);
    // Hiç atanmamış ≠ uyumlu: sinyal yalnız VAROLAN veriden türer.
    expect(hepoSignal({ clientHasAssignments: false, overdueOpenCount: 0 })?.contribution).toBe(0);
    expect(hepoSignal({ clientHasAssignments: false, overdueOpenCount: 0 })?.value).toContain(
      "atanmış yükümlülük yok",
    );
  });

  it("sinyal açıklaması verinin kaynağını (HEPO modülü) taşır", () => {
    const s = hepoSignal({ clientHasAssignments: true, overdueOpenCount: 1 });
    expect(s?.value).toContain("1 vadesi geçmiş");
    expect(s?.explanation).toContain("HEPO");
  });
});
