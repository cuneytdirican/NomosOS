/**
 * SÜRÜM FARKI (satır bazlı LCS) — saf mantık testleri.
 *
 * Kabul ölçütü: eklenen/silinen satırlar doğru ayrışır; ardışık "çıktı+
 * girdi" blokları "değişen" çiftlerine iner; doyma tavanı aşınca kaba
 * fallback uygulanır ve hiçbir fark SESSİZ kalmaz.
 */

import { describe, expect, it } from "vitest";
import { diffCounts, diffLines, diffPages, MAX_DIFF_LINES, splitLines } from "./contract-diff";

const V1 = [
  "VEKALET ÜCRET SÖZLEŞMESİ",
  "",
  "Madde 3 — Ücret: Peşin ücret 150.000,00 TL olup, dava değerinin %10'u",
  "oranında başarı primi tahsilat gerçekleştikçe hak edilir.",
  "",
  "Madde 6 — Uyuşmazlık: İstanbul Mahkemeleri yetkilidir.",
].join("\n");

const V2 = [
  "VEKALET ÜCRET SÖZLEŞMESİ",
  "",
  "Madde 3 — Ücret: Peşin ücret 150.000,00 TL olup, tahsilat gerçekleşse de",
  "gerçekleşmese de dava değerinin %10'u oranında başarı primi ödenir.",
  "",
  "Madde 6 — Uyuşmazlık: Ankara Mahkemeleri yetkilidir.",
].join("\n");

describe("sürüm farkı — satır bölme", () => {
  it("CRLF ve LF satır sonları aynı sonucu verir", () => {
    const lf = splitLines("a\nb");
    const crlf = splitLines("a\r\nb");
    expect(lf).toEqual(crlf);
    expect(lf).toEqual(["a", "b"]);
  });

  it("satır sonundaki boşluklar karşılaştırmayı bozmaz", () => {
    expect(diffLines("Madde 1 — metin   \nMadde 2", "Madde 1 — metin\nMadde 2")).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });
});

describe("sürüm farkı — LCS", () => {
  it("özdeş metinlerde fark boştur", () => {
    expect(diffLines(V1, V1)).toEqual({ added: [], removed: [], changed: [] });
  });

  it("değişen satırlar 'changed' çiftlerine iner (eklenen yeşil / silinen kırmızı yerine)", () => {
    const diff = diffLines(V1, V2);
    // Ortak satırlar (başlık, boşluklar, madde başları) fark dışı kalır.
    expect(diff.removed).toEqual([]);
    expect(diff.changed.map((c) => c.before)).toContain(
      "Madde 3 — Ücret: Peşin ücret 150.000,00 TL olup, dava değerinin %10'u",
    );
    expect(diff.changed.map((c) => c.after)).toContain(
      "Madde 6 — Uyuşmazlık: Ankara Mahkemeleri yetkilidir.",
    );
  });

  it("eklenen satır 'added'a, silinen satır 'removed'a düşer", () => {
    const diff = diffLines("Madde 1\nMadde 2", "Madde 1\nMadde 2\nMadde 3");
    expect(diff.added).toEqual(["Madde 3"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);

    const del = diffLines("Madde 1\nMadde 2\nMadde 3", "Madde 1");
    expect(del.removed).toEqual(["Madde 2", "Madde 3"]);
    expect(del.added).toEqual([]);
  });

  it("blok boyu farklıysa artan satırlar added/removed kalır", () => {
    // 2 silinen satır ↔ 1 eklenen satır: 1 çift changed, 1 satır removed.
    const diff = diffLines("A\nB\nC", "A\nX\nC");
    expect(diff.changed).toEqual([{ before: "B", after: "X" }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    // 1 silinen ↔ 2 eklenen: 1 çift changed, 1 satır added.
    const diff2 = diffLines("A\nB\nC", "A\nX\nY\nC");
    expect(diff2.changed).toEqual([{ before: "B", after: "X" }]);
    expect(diff2.added).toEqual(["Y"]);
    expect(diff2.removed).toEqual([]);
  });

  it("ölçüler diffCounts ile sayı alanlarına birebir düşer", () => {
    // A\nB → A\nX\nY: B↔X "değişen", Y artan satır.
    const diff = diffLines("A\nB", "A\nX\nY");
    expect(diffCounts(diff)).toEqual({ addedCount: 1, removedCount: 0, changedCount: 1 });
  });
});

describe("sürüm farkı — tavan", () => {
  it("satır tavanı aşan metinlerde kaba fallback: her satır çıkan/giren sayılır", () => {
    const n = Math.ceil(MAX_DIFF_LINES / 2) + 10;
    const bigA = Array.from({ length: n }, (_, i) => `eski satır ${i}`).join("\n");
    const bigB = Array.from({ length: n }, (_, i) => `yeni satır ${i}`).join("\n");
    const diff = diffLines(bigA, bigB);
    expect(diff.added.length).toBe(n);
    expect(diff.removed.length).toBe(n);
    expect(diff.changed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SAYFA PENCERELİ FARK — çok sayfalı sözleşmeler (ölçeklendirme)
// ---------------------------------------------------------------------------

/** Sayfa başına ~3.000 karakterlik sentetik sözleşme metni. */
function pageText(page: number, salt = ""): string {
  const lines = [`BÖLÜM ${page} — TARAFLARIN YÜKÜMLÜLÜKLERİ ${salt}`];
  for (let m = 1; m <= 10; m += 1) {
    lines.push(
      `Madde ${page * 10 + m} — İşbu bölümde yer alan hükümler taraf ${page}.${m} tarafından ` +
        "karşılıklı mutabakatla belirlenmiş olup sözleşmenin kalan hükümleriyle birlikte " +
        "okunacaktır. Taraflar bu hükümlerin ifasına ilişkin yükümlülüklerini iyi niyet " +
        "kuralları çerçevesinde yerine getirmeyi kabul ve beyan ederler.",
    );
  }
  return lines.join("\n");
}

function syntheticPages(count: number): string {
  return Array.from({ length: count }, (_, i) => pageText(i + 1)).join("\n\n");
}

describe("sürüm farkı — sayfa penceresi", () => {
  it("özdeş metinlerde değişen sayfa çıkmaz", () => {
    const text = syntheticPages(50);
    const paged = diffPages(text, text);
    expect(paged.pages).toEqual([]);
    expect(paged.unchangedPages).toBe(50);
    expect(paged.pageCounts).toEqual({ a: 50, b: 50 });
    expect(paged.counts).toEqual({ addedCount: 0, removedCount: 0, changedCount: 0 });
  });

  it("tek sayfa değişince yalnızca o sayfa DEGISTI olarak döner", () => {
    const a = syntheticPages(30);
    const b = a.replace(pageText(12), pageText(12, "(REVİZE)"));
    const paged = diffPages(a, b);
    expect(paged.pages.length).toBeLessThanOrEqual(2); // değişen sayfa (+ yuvarlama komşusu olabilir)
    const changed = paged.pages.filter((p) => p.status === "DEGISTI");
    expect(changed.length).toBe(1);
    expect(changed[0].page).toBe(12);
    expect(changed[0].added.length + changed[0].changed.length).toBeGreaterThan(0);
    // Değişmeyen 29 sayfa atlanmıştır.
    expect(paged.unchangedPages).toBeGreaterThanOrEqual(28);
  });

  it("ortadan sayfa eklenince kayan numaralar pencere tarafından emilir", () => {
    const a = syntheticPages(20);
    const b = [pageText(1), pageText(2), pageText(3), pageText(100, "(EKLENEN)")]
      .concat(Array.from({ length: 17 }, (_, i) => pageText(i + 4)))
      .join("\n\n");
    const paged = diffPages(a, b);
    const added = paged.pages.filter((p) => p.status === "EKLENDI");
    expect(added.length).toBe(1);
    expect(added[0].page).toBe(4);
    // Kayan sayfaların TAMAMI değişmiş SAYILMAMALI: pencere onları eşlemiştir.
    expect(paged.pages.filter((p) => p.status === "DEGISTI").length).toBeLessThanOrEqual(2);
  });

  it("silinen sayfa SILINDI olarak döner", () => {
    const a = syntheticPages(10);
    const b = [pageText(1), pageText(2), pageText(4), pageText(5)]
      .concat(Array.from({ length: 5 }, (_, i) => pageText(i + 6)))
      .join("\n\n");
    const paged = diffPages(a, b);
    const removed = paged.pages.filter((p) => p.status === "SILINDI");
    expect(removed.length).toBe(1);
    expect(removed[0].page).toBe(3);
    expect(removed[0].removed.length).toBeGreaterThan(0);
  });

  it("300 sayfalık sözleşmede değişmeyen sayfalar atlanır (ölçek)", () => {
    const a = syntheticPages(300);
    const b = a.replace(pageText(250), pageText(250, "(REVİZE)"));
    const paged = diffPages(a, b);
    expect(paged.pages.length).toBeLessThanOrEqual(2);
    expect(paged.unchangedPages).toBeGreaterThanOrEqual(297);
    expect(paged.pageCounts).toEqual({ a: 300, b: 300 });
  });

  it("sayfa sayıları farklı uzunluklarda da ölçülür", () => {
    const a = syntheticPages(5);
    const b = syntheticPages(8);
    const paged = diffPages(a, b);
    expect(paged.pageCounts).toEqual({ a: 5, b: 8 });
    expect(paged.pages.some((p) => p.status === "EKLENDI")).toBe(true);
  });
});
