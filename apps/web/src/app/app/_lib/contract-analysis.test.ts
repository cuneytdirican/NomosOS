/**
 * Sözleşme Analizi arayüz yardımcıları — saf mantık testleri.
 *
 * Kabul ölçütleri: madde bölme "Madde 7 —" başlıklarını ayırır; şerh önce
 * numarayla, numara yoksa alıntıyla bloğa bağlanır; kenarlık rengi en ağır
 * şiddetten gelir.
 */

import { describe, expect, it } from "vitest";
import type { ContractAnnotation, ContractClauseBlock } from "./contract-analysis-types";
import {
  annotationsForBlock,
  blockSeverity,
  clauseNumberOf,
  readEnvelope,
  splitClauses,
} from "./contract-analysis";

const SAMPLE = [
  "VEKALET ÜCRET SÖZLEŞMESİ",
  "",
  "Madde 1 — Taraflar: Bir tarafta büro, diğer tarafta müvekkil.",
  "",
  "Madde 7 — Cezai Şart: Erken fesihte kalan bedelin tamamı ödenir.",
  "Karşı tarafın fesihte herhangi bir yaptırımı yoktur.",
  "",
  "Madde 12 — Yetki: İstanbul Mahkemeleri yetkilidir.",
].join("\n");

function annotation(patch: Partial<ContractAnnotation>): ContractAnnotation {
  return {
    id: "a1",
    runId: "r1",
    clauseRef: null,
    pageFrom: null,
    pageTo: null,
    severity: "ORTA",
    explanation: "gerekçe",
    quote: null,
    proposedFix: null,
    status: "ACIK",
    closedAt: null,
    closeNote: null,
    createdAt: null,
    ...patch,
  };
}

describe("splitClauses — madde bölme", () => {
  it("madde başlıkları yeni blok açar; başlık metni bloğa dahildir", () => {
    const blocks = splitClauses(SAMPLE);
    const refs = blocks.filter((b) => b.number !== null).map((b) => b.ref);
    expect(refs).toEqual(["m.1", "m.7", "m.12"]);
  });

  it("madde dışı giriş metni ref'siz blokta kalır", () => {
    const blocks = splitClauses(SAMPLE);
    expect(blocks[0].number).toBeNull();
    expect(blocks[0].text).toContain("VEKALET ÜCRET SÖZLEŞMESİ");
  });

  it("madde bloğu madde başlığından sonraki satırları da taşır", () => {
    const blocks = splitClauses(SAMPLE);
    const m7 = blocks.find((b) => b.number === 7);
    expect(m7?.text).toContain("Karşı tarafın fesihte herhangi bir yaptırımı yoktur.");
  });

  it("'m.7' ve '7.' biçimleri de madde başı sayılır", () => {
    const blocks = splitClauses("m.3 metin\n7. sayılı bent\n7) başka");
    const refs = blocks.map((b) => b.ref);
    expect(refs).toEqual(expect.arrayContaining(["m.3", "m.7"]));
  });
});

describe("clauseNumberOf — madde numarası çıkarma", () => {
  it("'m.7' → 7, 'Madde 12' → 12", () => {
    expect(clauseNumberOf("m.7")).toBe(7);
    expect(clauseNumberOf("Madde 12")).toBe(12);
  });

  it("sayı yoksa null döner", () => {
    expect(clauseNumberOf("Ek-1")).toBeNull();
  });
});

describe("annotationsForBlock — şerh eşleştirme", () => {
  const m7: ContractClauseBlock = {
    ref: "m.7",
    number: 7,
    text: "Madde 7 — Cezai Şart: Erken fesihte kalan bedelin tamamı ödenir.",
  };

  it("madde numarasıyla eşleşen şerh bloğa bağlanır", () => {
    const sherh = annotation({ clauseRef: "m.7", severity: "KRITIK" });
    expect(annotationsForBlock(m7, [sherh, annotation({ clauseRef: "m.12" })])).toEqual([sherh]);
  });

  it("numarasız şerh alıntısı blok metninde geçiyorsa bağlanır", () => {
    const sherh = annotation({
      clauseRef: null,
      quote: "Erken fesihte kalan bedelin tamamı ödenir.",
    });
    expect(annotationsForBlock(m7, [sherh])).toEqual([sherh]);
    // Alıntıyı İÇERMEYEN bloğa bağlanmaz.
    const m12: ContractClauseBlock = {
      ref: "m.12",
      number: 12,
      text: "Madde 12 — Yetki: İstanbul Mahkemeleri yetkilidir.",
    };
    expect(annotationsForBlock(m12, [sherh])).toEqual([]);
  });
});

describe("blockSeverity — kenarlık rengi kaynağı", () => {
  it("en ağır şiddet kazanır: KRITIK > ORTA > DUSUK", () => {
    expect(blockSeverity([annotation({ severity: "ORTA" }), annotation({ severity: "DUSUK" })])).toBe("ORTA");
    expect(blockSeverity([annotation({ severity: "KRITIK" }), annotation({ severity: "ORTA" })])).toBe("KRITIK");
    expect(blockSeverity([annotation({ severity: "DUSUK" })])).toBe("DUSUK");
    expect(blockSeverity([])).toBeNull();
  });
});

describe("readEnvelope — sayfalama zarfı (şerh/olay listeleri take/skip ile sınırlı)", () => {
  it("zarfı okur: total, sayfa ve hasMore doğru hesaplanır", () => {
    const p = readEnvelope(
      { items: [1, 2, 3], total: 97, page: 2, limit: 3, totalPages: 33 },
      (n) => n,
    );
    expect(p.items).toEqual([1, 2, 3]);
    expect(p.total).toBe(97);
    expect(p.page).toBe(2);
    expect(p.hasMore).toBe(true);
  });

  it("son sayfada hasMore kapalıdır", () => {
    const p = readEnvelope(
      { items: [1], total: 97, page: 33, limit: 3, totalPages: 33 },
      (n) => n,
    );
    expect(p.hasMore).toBe(false);
  });

  it("boş zarf: 300 sayfalık sözleşmede bile dönen liste sınırlıdır", () => {
    const p = readEnvelope({ items: [], total: 0, page: 1, limit: 100, totalPages: 1 }, (n) => n);
    expect(p.items).toEqual([]);
    expect(p.total).toBe(0);
    expect(p.hasMore).toBe(false);
  });
});
