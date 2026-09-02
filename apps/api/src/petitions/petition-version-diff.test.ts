/**
 * SÜRÜM FARKI MOTORU BİRİM TESTLERİ (D5 / cila).
 *
 * LCS satır farkı + bölüm eşleşmesi deterministik ve testlidir;
 * arayüz yalnız sonucu çizer.
 */

import { describe, expect, it } from "vitest";
import { diffLines, diffSections, summarizeDiff } from "./petition-version-diff";
import type { PetitionSectionBody } from "./petition-sections";

function sec(key: string, title: string, body: string, origin: "MANUAL" | "AI" | "TEMPLATE" = "MANUAL"): PetitionSectionBody {
  return { key, title, body, origin };
}

describe("diffLines — LCS satır farkı", () => {
  it("özdeş metinlerde satır değişikliği yoktur", () => {
    const d = diffLines("a\nb\nc", "a\nb\nc");
    expect(d.every((l) => l.op === "same")).toBe(true);
    expect(d.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  it("eklenen satır işaretlenir", () => {
    const d = diffLines("a\nc", "a\nb\nc");
    const added = d.filter((l) => l.op === "added");
    expect(added.map((l) => l.text)).toEqual(["b"]);
    expect(d.filter((l) => l.op === "removed")).toHaveLength(0);
  });

  it("çıkarılan satır işaretlenir", () => {
    const d = diffLines("a\nb\nc", "a\nc");
    const removed = d.filter((l) => l.op === "removed");
    expect(removed.map((l) => l.text)).toEqual(["b"]);
  });

  it("değiştirilen satır ekleme+çıkarma olarak görünür", () => {
    const d = diffLines("eski satır", "yeni satır");
    expect(d.find((l) => l.op === "removed")?.text).toBe("eski satır");
    expect(d.find((l) => l.op === "added")?.text).toBe("yeni satır");
  });

  it("boş → dolu: her satır eklenmedir", () => {
    const d = diffLines("", "x\ny");
    expect(d.every((l) => l.op === "added")).toBe(true);
    expect(d).toHaveLength(2);
  });

  it("orta blok taşınırken en uzun ortak dizi korunur", () => {
    const from = ["baş", "orta1", "orta2", "son"].join("\n");
    const to = ["baş", "orta1", "orta2-YENİ", "son"].join("\n");
    const d = diffLines(from, to);
    expect(d.filter((l) => l.op === "same").map((l) => l.text)).toEqual(["baş", "orta1", "son"]);
    expect(d.find((l) => l.op === "removed")?.text).toBe("orta2");
    expect(d.find((l) => l.op === "added")?.text).toBe("orta2-YENİ");
  });
});

describe("diffSections — bölüm düzeyi", () => {
  it("değişmeyen bölüm UNCHANGED, satır farkı üretmez", () => {
    const d = diffSections([sec("k", "Başlık", "metin")], [sec("k", "Başlık", "metin")]);
    expect(d[0].change).toBe("UNCHANGED");
    expect(d[0].addedLines + d[0].removedLines).toBe(0);
  });

  it("gövdesi değişen bölüm CHANGED + satır farkı dolar", () => {
    const d = diffSections([sec("k", "Başlık", "a")], [sec("k", "Başlık", "a\nb")]);
    expect(d[0].change).toBe("CHANGED");
    expect(d[0].addedLines).toBe(1);
    expect(d[0].removedLines).toBe(0);
  });

  it("hedefte olmayan bölüm REMOVED, kaynakta olmayan ADDED", () => {
    const d = diffSections(
      [sec("a", "A", "x"), sec("b", "B", "y")],
      [sec("b", "B", "y"), sec("c", "C", "z")]
    );
    const byKey = Object.fromEntries(d.map((s) => [s.key, s.change]));
    expect(byKey["a"]).toBe("REMOVED");
    expect(byKey["b"]).toBe("UNCHANGED");
    expect(byKey["c"]).toBe("ADDED");
  });

  it("başlık yeniden yazılsa da ANAHTAR eşleşmesi sürer", () => {
    const d = diffSections([sec("k", "HUKUKİ SEBEPLER", "a")], [sec("k", "Hukuki Sebep Plar", "a")]);
    expect(d).toHaveLength(1);
    expect(d[0].change).toBe("UNCHANGED");
  });

  it("özet sayaçlar bölüm/satır kırılımlarını verir", () => {
    const d = diffSections(
      [sec("a", "A", "x1\nx2"), sec("b", "B", "y")],
      [sec("a", "A", "x1"), sec("b", "B", "y\nz"), sec("c", "C", "yeni")]
    );
    const s = summarizeDiff(d);
    expect(s.changedSections).toBe(2); // a: 1 satır çıktı; b: 1 satır eklendi
    expect(s.addedSections).toBe(1);
    expect(s.removedSections).toBe(0);
    expect(s.unchangedSections).toBe(0);
    expect(s.removedLines).toBe(1);
    expect(s.addedLines).toBe(2);
  });
});
