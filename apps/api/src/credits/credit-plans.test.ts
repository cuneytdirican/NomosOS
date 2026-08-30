/**
 * KREDİ MATEMATİĞİ — birim testleri.
 *
 * Bu dosyadaki her test, denetimde tespit edilmiş bir davranışı KİLİTLER:
 * kredi tam sayıdır, bakiye negatife düşemez, rezerve krediler harcanmış
 * sayılır, dahil kota önce tüketilir.
 */

import { describe, expect, it } from "vitest";
import {
  CONTEXT_FREE_TOKENS,
  MAX_CREDITS_PER_REQUEST,
  adjustmentRejection,
  approximateTokens,
  availableCredits,
  contextMultiplier,
  estimateCredits,
  nextPeriod,
  planQuota,
  settledBalance,
  usagePercent,
} from "./credit-plans";

const wallet = (over: Partial<Parameters<typeof availableCredits>[0]> = {}) => ({
  includedCredits: 500,
  includedConsumed: 0,
  purchasedCredits: 0,
  reservedCredits: 0,
  ...over,
});

describe("approximateTokens", () => {
  it("negatif ve geçersiz girdide 0 döner (tahmin asla NaN olmaz)", () => {
    expect(approximateTokens(-5)).toBe(0);
    expect(approximateTokens(Number.NaN)).toBe(0);
    expect(approximateTokens(0)).toBe(0);
  });

  it("YUKARI yuvarlar — tahmin gerçekten olandan AZ çıkmamalı", () => {
    // 3.5 karakter/token; 10 karakter → 2.857 → 3
    expect(approximateTokens(10)).toBe(3);
  });
});

describe("contextMultiplier", () => {
  it("ücretsiz eşiğe kadar çarpan 1'dir", () => {
    expect(contextMultiplier(0)).toBe(1);
    expect(contextMultiplier(CONTEXT_FREE_TOKENS)).toBe(1);
  });

  it("KADEMELİDİR: her 8.000 token bloğu %25 ekler", () => {
    expect(contextMultiplier(CONTEXT_FREE_TOKENS + 1)).toBe(1.25);
    expect(contextMultiplier(16_000)).toBe(1.25);
    expect(contextMultiplier(16_001)).toBe(1.5);
    expect(contextMultiplier(24_000)).toBe(1.5);
  });
});

describe("estimateCredits", () => {
  it("ücretsiz görevde (taban 0) çarpan ne olursa olsun 0 döner", () => {
    expect(estimateCredits(0, 1_000_000)).toBe(0);
  });

  it("TAM SAYI döner — kredi hiçbir yerde kesirli olmaz", () => {
    const credits = estimateCredits(30, 71_429);
    expect(Number.isInteger(credits)).toBe(true);
  });

  it("STRATEGY_BUILD + 250k karakterlik bağlam 50 kredi tavanını AŞAR", () => {
    // Denetim koşusunda canlı doğrulanan senaryo: 250.000 karakter → 71.429
    // token → çarpan 3 → 90 kredi.
    const tokens = approximateTokens(250_000);
    const credits = estimateCredits(30, tokens);
    expect(contextMultiplier(tokens)).toBe(3);
    expect(credits).toBe(90);
    expect(credits > MAX_CREDITS_PER_REQUEST).toBe(true);
  });

  it("CASE_FULL_ANALYSIS + 120k karakter tavanı aşmaz", () => {
    const credits = estimateCredits(20, approximateTokens(120_000));
    expect(credits).toBe(40);
    expect(credits > MAX_CREDITS_PER_REQUEST).toBe(false);
  });
});

describe("availableCredits / settledBalance", () => {
  it("kullanılabilir bakiye REZERVEYİ düşer, mutabakat bakiyesi DÜŞMEZ", () => {
    const w = wallet({ includedConsumed: 100, purchasedCredits: 50, reservedCredits: 30 });
    // (500-100) + 50 - 30
    expect(availableCredits(w)).toBe(420);
    // Rezerve krediler henüz TÜKETİLMEMİŞTİR; hareket defterine yazılmazlar.
    expect(settledBalance(w)).toBe(450);
  });
});

describe("adjustmentRejection — negatif düzeltme kapısı", () => {
  it("pozitif düzeltmeyi hiç engellemez", () => {
    expect(adjustmentRejection(wallet({ purchasedCredits: 0 }), 100)).toBeNull();
  });

  it("kullanılabilir bakiye yetiyorsa geçirir", () => {
    expect(adjustmentRejection(wallet({ purchasedCredits: 100 }), -100)).toBeNull();
  });

  it("REZERVEYİ SAYAR: purchased=100 & reserved=100 iken -100 REDDEDİLİR", () => {
    // Denetim bulgusu: eski kontrol yalnız `purchasedCredits + delta < 0`
    // bakıyordu ve bu düzeltme geçiyordu. Uçuştaki çağrı mahsuplaştığında
    // purchasedCredits = -100 kalıyordu.
    const w = wallet({ includedCredits: 0, purchasedCredits: 100, reservedCredits: 100 });
    expect(availableCredits(w)).toBe(0);
    const rejection = adjustmentRejection(w, -100);
    expect(rejection).not.toBeNull();
    expect(rejection).toContain("negatife çekilemez");
  });

  it("dahil kotadaki kalanı da hesaba katar", () => {
    const w = wallet({ includedCredits: 500, includedConsumed: 400, purchasedCredits: 0 });
    // Kullanılabilir 100.
    expect(adjustmentRejection(w, -100)).toBeNull();
    expect(adjustmentRejection(w, -101)).not.toBeNull();
  });
});

describe("planQuota", () => {
  it("Solo sabit 500 kredi / 200 belge (tanıtım sitesindeki sayılarla aynı)", () => {
    const q = planQuota("SOLO", 1, { includedCredits: 0, documentQuota: 0 });
    expect(q.credits).toBe(500);
    expect(q.documents).toBe(200);
  });

  it("Büro koltuk başına 400 kredi / 250 belge — havuz ortaktır", () => {
    const q = planQuota("BURO", 5, { includedCredits: 0, documentQuota: 0 });
    expect(q.credits).toBe(2000);
    expect(q.documents).toBe(1250);
  });

  it("ENTERPRISE'da SAYI UYDURULMAZ: cüzdandaki değer korunur", () => {
    const q = planQuota("ENTERPRISE", 20, { includedCredits: 12_345, documentQuota: 999 });
    expect(q.credits).toBe(12_345);
    expect(q.documents).toBe(999);
    expect(q.basis).toContain("sözleşmeye bağlıdır");
  });

  it("bilinmeyen planda da kota uydurmaz", () => {
    const q = planQuota("YOK_BOYLE_PLAN", 3, { includedCredits: 77, documentQuota: 11 });
    expect(q.credits).toBe(77);
  });

  it("koltuk sayısı bozuksa en az 1 kabul edilir", () => {
    const q = planQuota("BURO", 0, { includedCredits: 0, documentQuota: 0 });
    expect(q.credits).toBe(400);
  });
});

describe("nextPeriod", () => {
  it("UTC ay başından ay başına, bitiş DIŞLAYICI", () => {
    const p = nextPeriod(new Date("2026-08-17T10:00:00Z"));
    expect(p.periodStart.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(p.periodEnd.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("yıl sınırını doğru geçer", () => {
    const p = nextPeriod(new Date("2026-12-05T00:00:00Z"));
    expect(p.periodEnd.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("usagePercent", () => {
  it("hiç tüketim yokken 0", () => {
    expect(usagePercent(wallet())).toBe(0);
  });

  it("kota bittiğinde 100", () => {
    expect(usagePercent(wallet({ includedConsumed: 500 }))).toBe(100);
  });

  it("0-100 aralığının dışına çıkmaz", () => {
    expect(usagePercent(wallet({ includedConsumed: 900 }))).toBe(100);
    expect(usagePercent(wallet({ includedCredits: 0, purchasedCredits: 0 }))).toBe(0);
  });
});
