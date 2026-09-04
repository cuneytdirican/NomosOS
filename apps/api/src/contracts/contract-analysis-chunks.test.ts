/**
 * SÖZLEŞME ANALİZİ PARÇALAMASI — saf mantık testleri.
 *
 * Kabul ölçütü: 300 sayfalık sentetik sözleşme metni sanal sayfalara ve
 * analiz parçalarına ölçekli bölünür; parça sayfa künyeleri taşır; kredi
 * tahmini (estimateAnalysisUnits) aynı hesabı verir.
 */

import { describe, expect, it } from "vitest";
import {
  ANALYSIS_CHUNK_CHARS,
  buildAnalysisChunks,
  CONTRACT_PAGE_CHARS,
  estimateAnalysisUnits,
  MAX_ANALYSIS_CHUNKS,
  splitIntoPages,
} from "./contract-analysis-chunks";

/** Sayfa başına ~CONTRACT_PAGE_CHARS karakterlik sentetik sözleşme metni. */
function syntheticContract(pages: number): string {
  const out: string[] = [];
  for (let page = 1; page <= pages; page += 1) {
    out.push(`BÖLÜM ${page} — TARAFLARIN YÜKÜMLÜLÜKLERİ`);
    for (let m = 1; m <= 8; m += 1) {
      out.push(
        `Madde ${page * 8 + m} — İşbu bölümde yer alan hükümler, taraf ${page}.${m} ` +
          "tarafından karşılıklı mutabakatla belirlenmiş olup sözleşmenin kalan hükümleriyle " +
          "birlikte okunacaktır. Taraflar bu hükümlerin ifasına ilişkin yükümlülüklerini " +
          "iyi niyet kuralları çerçevesinde yerine getirmeyi kabul ve beyan ederler.",
      );
    }
    if (page < pages) out.push("");
  }
  return out.join("\n");
}

describe("splitIntoPages — sanal sayfalama", () => {
  it("boş metin sayfa üretmez", () => {
    expect(splitIntoPages("")).toEqual([]);
    expect(splitIntoPages("   \n\n  ")).toEqual([]);
  });

  it("sayfa numaraları 1'den başlar ve ardışıktır", () => {
    const pages = splitIntoPages(syntheticContract(20));
    expect(pages.map((p) => p.page)).toEqual(pages.map((_, i) => i + 1));
  });

  it("sayfa boyutu hedefe yakın kalır (paragraf sınırına yuvarlanır)", () => {
    const pages = splitIntoPages(syntheticContract(50));
    for (const p of pages) {
      // Tek bir paragraf sayfa boyutunu aşmadıkça sayfa ~%50 bandın içinde kalır.
      expect(p.text.length).toBeLessThanOrEqual(Math.ceil(CONTRACT_PAGE_CHARS * 1.5));
    }
  });

  it("300 sayfalık metin ≈300 sanal sayfa üretir", () => {
    const text = syntheticContract(300);
    const pages = splitIntoPages(text);
    // Sentetik üretici sayfa başına ~2.400 karakter basar; iki bölüm bir
    // sayfaya sığmadığından (2.400 × 2 > 3.000) her bölüm kendi sayfasını
    // açar: 300 bölüm → 300 sanal sayfa.
    expect(pages.length).toBe(300);
    // Karakter ölçüsüyle de tutarlı (±%30 — paragraf yuvarlama payı).
    const expected = Math.ceil(text.length / CONTRACT_PAGE_CHARS);
    expect(pages.length).toBeGreaterThan(expected * 0.7);
    expect(pages.length).toBeLessThan(expected * 1.3);
  });
});

describe("buildAnalysisChunks — analiz parçaları", () => {
  it("her parça sayfa künyesi (pageFrom/pageTo) taşır", () => {
    const chunks = buildAnalysisChunks(syntheticContract(30), {
      documentId: "v1",
      documentTitle: "Sözleşme",
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.pageFrom).toBeGreaterThanOrEqual(1);
      expect(chunk.pageTo).toBeGreaterThanOrEqual(chunk.pageFrom!);
      expect(chunk.citationLabel).toContain("s.");
    }
  });

  it("parça boyutu tavanı aşmaz ve sayfa sırası tek yönlüdür", () => {
    const chunks = buildAnalysisChunks(syntheticContract(300), {
      documentId: "v1",
      documentTitle: "Sözleşme",
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThanOrEqual(MAX_ANALYSIS_CHUNKS);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(ANALYSIS_CHUNK_CHARS + 2000);
    }
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].pageFrom!).toBeGreaterThanOrEqual(chunks[i - 1].pageFrom!);
    }
  });

  it("300 sayfalık sözleşme makul sayıda AI çağrısına iner (ölçeklendirme)", () => {
    const text = syntheticContract(300);
    const chunks = buildAnalysisChunks(text, { documentId: "v1", documentTitle: "S" });
    // 300 sayfa ≈ 900.000+ karakter; 24.000 karakterlik parçalarla onlarca
    // çağrıya inmelidir — ama yüzlerce çağrıya ÇIKMAMALIDIR.
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.length).toBeLessThan(150);
  });

  it("parçalar metnin TAMAMINI kapsar (ilk parça baştan, son parça sona)", () => {
    const text = syntheticContract(40);
    const chunks = buildAnalysisChunks(text, { documentId: "v1", documentTitle: "S" });
    expect(chunks[0].content).toContain("BÖLÜM 1 —");
    expect(chunks[chunks.length - 1].content).toContain("Madde 320");
  });
});

describe("estimateAnalysisUnits — kredi tahmini kaynağı", () => {
  it("tahmin, gerçek bölmeyle AYNI parça sayısını verir", () => {
    const text = syntheticContract(120);
    const chunks = buildAnalysisChunks(text, { documentId: "v1", documentTitle: "S" });
    const estimate = estimateAnalysisUnits(text);
    expect(estimate.chunkCount).toBe(chunks.length);
    expect(estimate.pageCount).toBe(splitIntoPages(text).length);
    expect(estimate.chars).toBe(text.trim().length);
    // Birim ölçüsü (en uzun parça) gerçek parça boyutunu aşmaz.
    expect(estimate.chunkChars).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(estimate.chunkChars);
    }
  });

  it("kısa sözleşme tek parçadır (1 sayfalık sözleşme davranışı değişmez)", () => {
    const estimate = estimateAnalysisUnits(
      "Madde 1 — Taraflar: Bir tarafta büro, diğer tarafta müvekkil.\n\nMadde 2 — Konu: Danışmanlık.",
    );
    expect(estimate.chunkCount).toBe(1);
    expect(estimate.pageCount).toBe(1);
  });

  it("boş metin sıfır ölçü döner", () => {
    expect(estimateAnalysisUnits("   ")).toEqual({
      chunkCount: 0,
      pageCount: 0,
      chars: 0,
      chunkChars: 0,
    });
  });
});
