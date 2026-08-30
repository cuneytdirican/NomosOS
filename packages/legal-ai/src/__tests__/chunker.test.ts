import { describe, expect, it } from "vitest";

import { chunkDocument, chunkPagedDocument, splitParagraphs } from "../rag/chunker";

const SOURCE = {
  documentId: "doc-88",
  documentTitle: "Cevap Dilekçesi",
  documentClass: "DILEKCE",
};

function makeParagraph(n: number, length = 60): string {
  const base = `Paragraf ${n}: `;
  return base + "x".repeat(Math.max(0, length - base.length));
}

const EIGHT_PARAGRAPHS = Array.from({ length: 8 }, (_, i) => makeParagraph(i + 1)).join("\n\n");

describe("rag/chunker", () => {
  it("paragrafları boş satır sınırından ayırır ve boşlukları atar", () => {
    const paragraphs = splitParagraphs("Bir.\n\n\n  İki.  \n\nÜç.");
    expect(paragraphs.map((p) => p.text)).toEqual(["Bir.", "İki.", "Üç."]);
  });

  it("paragraf sınırını korur: hiçbir parça paragrafı ortadan bölmez", () => {
    const chunks = chunkDocument(EIGHT_PARAGRAPHS, SOURCE, {
      maxChars: 200,
      overlapChars: 100,
      minChars: 10,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const line of chunk.content.split("\n\n")) {
        expect(EIGHT_PARAGRAPHS).toContain(line);
      }
    }
  });

  it("ardışık parçalar örtüşür (sınıra denk gelen ifade kaybolmaz)", () => {
    const chunks = chunkDocument(EIGHT_PARAGRAPHS, SOURCE, {
      maxChars: 200,
      overlapChars: 100,
      minChars: 10,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < chunks.length; i++) {
      const previous = chunks[i - 1];
      const current = chunks[i];
      const firstParagraphOfCurrent = current.content.split("\n\n")[0];
      expect(previous.content).toContain(firstParagraphOfCurrent);
      expect(current.overlapChars).toBeGreaterThan(0);
      expect(current.paragraphFrom).toBeLessThanOrEqual(previous.paragraphTo);
    }
  });

  it("örtüşme kapalıyken parçalar örtüşmez", () => {
    const chunks = chunkDocument(EIGHT_PARAGRAPHS, SOURCE, {
      maxChars: 200,
      overlapChars: 0,
      minChars: 10,
    });
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].overlapChars).toBe(0);
      expect(chunks[i].paragraphFrom).toBeGreaterThan(chunks[i - 1].paragraphTo);
    }
  });

  it("her parçaya kaynak künyesi iliştirir (belge adı + paragraf aralığı)", () => {
    const chunks = chunkDocument(EIGHT_PARAGRAPHS, SOURCE, {
      maxChars: 200,
      overlapChars: 100,
      minChars: 10,
    });

    for (const chunk of chunks) {
      expect(chunk.source.documentId).toBe("doc-88");
      expect(chunk.citationLabel).toContain("Cevap Dilekçesi");
      expect(chunk.citationLabel).toContain("¶");
      expect(chunk.paragraphFrom).toBeGreaterThan(0);
      expect(chunk.paragraphTo).toBeGreaterThanOrEqual(chunk.paragraphFrom);
    }
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it("sayfalı belgede künyeye sayfa numarası girer", () => {
    const chunks = chunkPagedDocument(
      [
        { page: 1, text: `${makeParagraph(1)}\n\n${makeParagraph(2)}` },
        { page: 2, text: `${makeParagraph(3)}\n\n${makeParagraph(4)}` },
        { page: 3, text: `${makeParagraph(5)}\n\n${makeParagraph(6)}` },
      ],
      SOURCE,
      { maxChars: 200, overlapChars: 100, minChars: 10 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.pageFrom).toBeDefined();
      expect(chunk.citationLabel).toMatch(/s\.\d/);
    }
  });

  it("maksimum boyutu aşan tek paragrafı cümle sınırından böler", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Bu ${i + 1}. cümledir ve yeterince uzundur.`).join(" ");
    const chunks = chunkDocument(long, SOURCE, { maxChars: 120, overlapChars: 30, minChars: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(200);
    }
  });

  it("örtüşme parça boyutundan büyükse Türkçe hata verir", () => {
    expect(() => chunkDocument("metin", SOURCE, { maxChars: 100, overlapChars: 200 })).toThrow(
      /örtüşme/i,
    );
  });
});
