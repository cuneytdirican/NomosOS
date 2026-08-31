/**
 * K-05 REGRESYON TESTİ — vadesiz faturanın yaşlandırması.
 *
 * Canlı ölçülen hata: vadesiz, 2024 tarihli, hiç ödenmemiş bir fatura
 * `/finance/summary` ucunda "0-30 gün gecikme" sayılıyordu (overdueDays 0'a
 * kırpılıyordu), oysa rapor ucunda "91+ gün / 959 gün" görünüyordu. Kurallar
 * `aging-rules.ts`'e alındı; bu test kırpmanın geri gelmesini yakalar.
 */

import { describe, expect, it } from "vitest";
import {
  agingBucketOf,
  agingReferenceDate,
  isOverdue,
  overdueDaysOf,
} from "./aging-rules";

const D = (iso: string) => new Date(iso);
const TODAY = D("2026-08-31T10:00:00Z");

describe("K-05: vadesiz fatura düzenleme tarihinden yaşlanır", () => {
  it("vadesi YOKSA düzenleme tarihi referanstır — 959 gün gecikme kaybolmaz", () => {
    const inv = { dueDate: null, issueDate: D("2024-01-15T00:00:00Z") };
    const ref = agingReferenceDate(inv);
    expect(ref).toBe(inv.issueDate);
    const days = overdueDaysOf(ref, TODAY);
    expect(days).toBeGreaterThan(950);
    expect(agingBucketOf(days)).toBe("90+");
    expect(isOverdue({ overdueDays: days })).toBe(true);
  });

  it("vade VARSA vade tarihi referanstır", () => {
    const inv = { dueDate: D("2025-01-15T00:00:00Z"), issueDate: D("2024-12-01T00:00:00Z") };
    expect(agingReferenceDate(inv)).toBe(inv.dueDate);
  });
});

describe("overdueDaysOf — işaret korunur", () => {
  it("negatif = vadesi henüz gelmemiş; kırpılmaz", () => {
    const days = overdueDaysOf(D("2026-09-30T00:00:00Z"), TODAY);
    expect(days).toBeLessThan(0);
    expect(agingBucketOf(days)).toBe("notDue");
    expect(isOverdue({ overdueDays: days })).toBe(false);
  });

  it("bugün vadesi dolan fatura 0 gündür ama hâlâ gecikmemiş sayılır", () => {
    const days = overdueDaysOf(D("2026-08-31T00:00:00Z"), TODAY);
    expect(days).toBe(0);
    expect(agingBucketOf(days)).toBe("0-30");
    expect(isOverdue({ overdueDays: 0 })).toBe(false);
  });

  it("gün sınırı hesabı UTC gün başına göredir, saat farkı taşımaz", () => {
    // 30 tam gün + 23 saat fark → 30 gün (31 DEĞİL).
    expect(overdueDaysOf(D("2026-08-01T01:00:00Z"), D("2026-08-31T00:00:00Z"))).toBe(30);
    expect(overdueDaysOf(D("2026-08-01T00:00:00Z"), D("2026-08-31T23:00:00Z"))).toBe(30);
  });
});

describe("agingBucketOf — kova sınırları", () => {
  it("sınır günleri doğru kovaya düşer", () => {
    expect(agingBucketOf(-1)).toBe("notDue");
    expect(agingBucketOf(0)).toBe("0-30");
    expect(agingBucketOf(30)).toBe("0-30");
    expect(agingBucketOf(31)).toBe("31-60");
    expect(agingBucketOf(60)).toBe("31-60");
    expect(agingBucketOf(61)).toBe("61-90");
    expect(agingBucketOf(90)).toBe("61-90");
    expect(agingBucketOf(91)).toBe("90+");
  });

  it("vadesizlik kova kararına KARIŞMAZ — karar yalnız işaretli gecikme gününden alınır", () => {
    // Vadesiz ama bugün düzenlenmiş fatura: 0 gün → 0-30 kovası (değil, notDue).
    const fresh = { dueDate: null, issueDate: TODAY };
    expect(agingBucketOf(overdueDaysOf(agingReferenceDate(fresh), TODAY))).toBe("0-30");
    expect(isOverdue({ overdueDays: 0 })).toBe(false);
  });
});
