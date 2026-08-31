/**
 * Yaşlandırma kova mantığı ve karşılaştırma aritmetiği testleri.
 *
 * Kova sınırı bir gün kayarsa "90+ gün" kovasındaki alacak "61-90"a düşer ve
 * tahsilat görüşmesinin aciliyeti yanlış okunur; bu yüzden sınır davranışı
 * (30 → hangi kova, 31 → hangi kova) açıkça çivilenir.
 */

import { describe, expect, it } from "vitest";
import { Prisma } from "@nomosos/db";
import { NOT_DUE_LABEL, bucketLabels, bucketOf } from "./builders/tahsilat-yaslandirma.report";
import {
  applyRowLimit,
  compareDescending,
  countMetric,
  finishTable,
  moneyMetric,
  percentMetric,
  ratioPercent,
  takeWithProbe,
  truncationWarning,
  wholeDaysBetween,
} from "./report-helpers";

describe("yaşlandırma kovaları", () => {
  const thresholds = [30, 60, 90];
  const labels = bucketLabels(thresholds);

  /**
   * DENETİM BULGUSU 19 — SON KOVANIN ETİKETİ GERÇEK ALT SINIRINI SÖYLER.
   *
   * Etiket eskiden "90+ gün" üretiliyordu ama `bucketOf` 90 günü "61-90"
   * kovasına koyuyordu; yani ekranda ve CSV başlığında "90+ gün" yazan sütun
   * 90 günlük alacağı İÇERMİYORDU. Etiketle davranış arasındaki bu bir günlük
   * kayma, tahsilat görüşmesinin aciliyetini yanlış okutur.
   */
  it("etiketler bitişik ve boşluksuzdur; son kova gerçek alt sınırını taşır", () => {
    expect(labels).toEqual(["0-30 gün", "31-60 gün", "61-90 gün", "91+ gün"]);
  });

  it("kova sınırları İKİ UCU DA DAHİLDİR", () => {
    expect(bucketOf(0, thresholds, labels)).toBe("0-30 gün");
    expect(bucketOf(30, thresholds, labels)).toBe("0-30 gün");
    expect(bucketOf(31, thresholds, labels)).toBe("31-60 gün");
    expect(bucketOf(60, thresholds, labels)).toBe("31-60 gün");
    expect(bucketOf(61, thresholds, labels)).toBe("61-90 gün");
    expect(bucketOf(90, thresholds, labels)).toBe("61-90 gün");
    expect(bucketOf(91, thresholds, labels)).toBe("91+ gün");
    expect(bucketOf(3650, thresholds, labels)).toBe("91+ gün");
  });

  it("her etiketin sayısı, o kovaya DÜŞEN gün değeriyle tutarlıdır", () => {
    // Etiket ile davranış ayrışamaz: son etiketin başındaki sayı, o kovaya
    // düşen EN KÜÇÜK gün olmalıdır.
    const last = labels[labels.length - 1];
    const lowerBound = Number.parseInt(last, 10);
    expect(bucketOf(lowerBound, thresholds, labels)).toBe(last);
    expect(bucketOf(lowerBound - 1, thresholds, labels)).not.toBe(last);
  });

  it("vadesi gelmemiş bakiye AYRI kovadadır — gecikmişle karışmaz", () => {
    expect(bucketOf(-1, thresholds, labels)).toBe(NOT_DUE_LABEL);
    expect(bucketOf(-500, thresholds, labels)).toBe(NOT_DUE_LABEL);
  });

  it("özel eşiklerle de tutarlıdır", () => {
    const custom = [15, 45];
    const customLabels = bucketLabels(custom);
    expect(customLabels).toEqual(["0-15 gün", "16-45 gün", "46+ gün"]);
    expect(bucketOf(15, custom, customLabels)).toBe("0-15 gün");
    expect(bucketOf(16, custom, customLabels)).toBe("16-45 gün");
    expect(bucketOf(45, custom, customLabels)).toBe("16-45 gün");
    expect(bucketOf(46, custom, customLabels)).toBe("46+ gün");
  });
});

describe("karşılaştırma aritmetiği", () => {
  it("önceki dönem sıfırsa yüzde değişim NULL'dur (uydurma %100 yazılmaz)", () => {
    const m = countMetric("x", "X", 5, 0);
    expect(m.delta).toBe(5);
    expect(m.deltaPercent).toBeNull();
  });

  it("azalış negatif yüzde üretir", () => {
    const m = countMetric("x", "X", 8, 10);
    expect(m.delta).toBe(-2);
    expect(m.deltaPercent).toBe(-20);
  });

  it("karşılaştırma verilmezse alanlar hiç doldurulmaz", () => {
    const m = countMetric("x", "X", 8, undefined);
    expect(m.previous).toBeUndefined();
    expect(m.deltaPercent).toBeUndefined();
  });

  it("para ölçüsü STRING taşır — float'a düşmez", () => {
    const m = moneyMetric(
      "p",
      "Para",
      new Prisma.Decimal("1234567.895"),
      new Prisma.Decimal("1000000.00"),
      "TRY",
    );
    // Kuruşa HALF_UP yuvarlanır ve string kalır.
    expect(m.value).toBe("1234567.90");
    expect(m.previous).toBe("1000000.00");
    expect(m.delta).toBe("234567.90");
    expect(typeof m.value).toBe("string");
  });

  it("para ölçüsünde önceki dönem sıfırsa yüzde NULL'dur", () => {
    const m = moneyMetric("p", "Para", new Prisma.Decimal("100"), new Prisma.Decimal("0"), "TRY");
    expect(m.deltaPercent).toBeNull();
  });

  it("yüzde ölçüsü iki basamağa yuvarlanır", () => {
    const m = percentMetric("o", "Oran", 33.33333, 50);
    expect(m.value).toBe(33.33);
    expect(m.delta).toBe(-16.67);
  });

  /**
   * DENETİM BULGUSU 6 — "ORAN ÖLÇÜLEMEDİ" İLE "ORAN SIFIR" AYNI ŞEY DEĞİLDİR.
   * Dönem içinde hiç fatura kesmemiş ama 500.000 TL tahsil etmiş bir büroya
   * "Tahsil oranı %0" yazmak, gerçeğin tersini söylemekti.
   */
  it("yüzde ölçüsü NULL taşıyabilir — payda yoksa 0 yazılmaz", () => {
    const m = percentMetric("o", "Oran", null, undefined);
    expect(m.value).toBeNull();
    expect(m.previous).toBeUndefined();
    expect(m.deltaPercent).toBeUndefined();
  });

  it("ratioPercent paydası sıfırken 0 döner (sıfıra bölme yok)", () => {
    expect(ratioPercent(5, 0)).toBe(0);
    expect(ratioPercent(1, 3)).toBe(33.33);
    expect(ratioPercent(3, 3)).toBe(100);
  });
});

describe("satır sınırı", () => {
  it("sınır altındaki tablo kırpılmaz", () => {
    const r = applyRowLimit([1, 2, 3], 10);
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(3);
  });

  it("kırpma SESSİZ değildir — gerçek toplam korunur", () => {
    const r = applyRowLimit([1, 2, 3, 4, 5], 2);
    expect(r.rows).toEqual([1, 2]);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(5);
  });

  /**
   * DENETİM BULGUSU 4 — SORGU SINIRINA DAYANMAK DA BİR KIRPMADIR.
   *
   * Üç rapor sorguyu `take: min(limit, N)` ile kırpıp sonra `finishTable`a
   * ZATEN KISA gelen diziyi veriyordu; `applyRowLimit` "sınır altında" görüp
   * `truncated=false` yazıyor, uyarı hiç üretilmiyordu. 640 kaçırılmış süresi
   * olan büro 500 satır görüyor, hiçbir uyarı almıyor ve 140 kaçırılmış süreyi
   * HİÇ görmüyordu.
   */
  it("sorgu sınırına dayanıldığında tablo KIRPILMIŞ işaretlenir ve uyarı üretir", () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ x: i }));
    const table = finishTable(
      { key: "t", title: "Kaçırılan süreler", columns: [{ key: "x", label: "X", type: "number" }] },
      rows,
      3,
      { queryLimitReached: true },
    );
    expect(table.truncated).toBe(true);
    expect(table.totalRowCountExact).toBe(false);
    const warning = truncationWarning(table);
    expect(warning).toBeDefined();
    expect(warning).toContain("DAHA FAZLASI VAR");
  });

  it("sorgu sınırına dayanılmadıysa toplam KESİNDİR", () => {
    const table = finishTable(
      { key: "t", title: "T", columns: [{ key: "x", label: "X", type: "number" }] },
      [{ x: 1 }, { x: 2 }],
      10,
    );
    expect(table.truncated).toBe(false);
    expect(table.totalRowCountExact).toBe(true);
    expect(truncationWarning(table)).toBeUndefined();
  });

  it("takeWithProbe daima BİR FAZLA satır ister — sınıra dayanma böyle anlaşılır", () => {
    expect(takeWithProbe(500)).toBe(501);
    expect(takeWithProbe(1)).toBe(2);
  });
});

/**
 * DENETİM BULGULARI 8 ve 24 — gün aritmetiği ve sıralama sözleşmesi.
 */
describe("gün farkı ve sıralama yardımcıları", () => {
  it("gün farkı SAAT BİLEŞENİNDEN etkilenmez", () => {
    const ref = new Date("2026-09-01T00:00:00.000Z");
    const midnight = new Date("2026-08-02T00:00:00.000Z");
    const afternoon = new Date("2026-08-02T14:30:00.000Z");
    // Aynı vade gününe sahip iki fatura AYNI yaşa düşmelidir; eskiden
    // 30 ve 29 gün çıkıyor ve farklı kovalara düşebiliyorlardı.
    expect(wholeDaysBetween(midnight, ref)).toBe(30);
    expect(wholeDaysBetween(afternoon, ref)).toBe(30);
  });

  it("gün farkı ileri tarihte NEGATİF döner (vadesi gelmemiş)", () => {
    expect(
      wholeDaysBetween(new Date("2026-09-10T09:00:00.000Z"), new Date("2026-09-01T00:00:00.000Z")),
    ).toBe(-9);
  });

  it("Decimal karşılaştırıcı EŞİTLİKTE 0 döner — sort sözleşmesi korunur", () => {
    const a = new Prisma.Decimal("100.00");
    const b = new Prisma.Decimal("100.00");
    expect(compareDescending(a, b)).toBe(0);
    expect(compareDescending(new Prisma.Decimal("5"), new Prisma.Decimal("9"))).toBeGreaterThan(0);
    expect(compareDescending(new Prisma.Decimal("9"), new Prisma.Decimal("5"))).toBeLessThan(0);
  });
});
