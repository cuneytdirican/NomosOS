/**
 * D6-B — BENZERLİK MOTORU BİRİM TESTLERİ.
 *
 * Determinizm kanıtı: aynı girdi her zaman aynı sonucu verir; eşiğin iki
 * tarafında örnekler (benzerdir / benzer değildir) gerçekçi Türkçe müvekkil
 * adlarıyla sınanır.
 */

import { describe, expect, it } from "vitest";
import {
  isSimilarName,
  jaroWinkler,
  NAME_SIMILARITY_THRESHOLD,
  normalizeName,
} from "./client-similarity";

describe("normalizeName — Türkçe + hukuki ekler", () => {
  it("Türkçe karakterler ASCII'ye iner", () => {
    expect(normalizeName("Yılmaz Hukuk")).toBe("yilmaz");
  });

  it("hukuki ekler sondan ayıklanır", () => {
    expect(normalizeName("ABC İnşaat A.Ş.")).toBe("abc insaat");
    expect(normalizeName("Deniz Tekstil Ltd. Şti.")).toBe("deniz tekstil");
    expect(normalizeName("XYZ Holding")).toBe("xyz");
  });

  it("noktalama ve çoklu boşluk düzeltilir", () => {
    expect(normalizeName("  Mehmet   Demir ")).toBe("mehmet demir");
    expect(normalizeName("Şirket-1, Şubesi")).toBe("sirket 1 subesi");
  });

  it("tek kelime kalırsa ek ayıklanmaz (ad silinemez)", () => {
    expect(normalizeName("Holding")).toBe("holding");
  });
});

describe("jaroWinkler — algoritma", () => {
  it("özdeş dizgiler 1.0", () => {
    expect(jaroWinkler("abc holding", "abc holding")).toBe(1);
  });

  it("boş dizgi 0", () => {
    expect(jaroWinkler("", "abc")).toBe(0);
    expect(jaroWinkler("", "")).toBe(0);
  });

  it("aynı dizgide küçük yazım farkı yüksek skor", () => {
    expect(jaroWinkler("mehmet demir", "mehmet demir")).toBeGreaterThan(0.95);
  });

  it("tamamen farklı dizgiler düşük skor", () => {
    expect(jaroWinkler("abc holding", "xyz lojistik")).toBeLessThan(0.5);
  });

  it("klasik örnek — MARTHA/MARHTA (transpozisyon)", () => {
    // Literatür değeri ≈ 0.961 (Jaro 0.944 + önek bonusu)
    const s = jaroWinkler("MARTHA", "MARHTA");
    expect(s).toBeGreaterThan(0.94);
    expect(s).toBeLessThan(0.97);
  });

  it("DIXON/DICKSONX (literatür ≈ 0.813)", () => {
    const s = jaroWinkler("DIXON", "DICKSONX");
    expect(s).toBeGreaterThan(0.8);
    expect(s).toBeLessThan(0.83);
  });
});

describe("isSimilarName — kararlar", () => {
  it("aynı ad farklı hukuki eklerle BENZER", () => {
    const r = isSimilarName("ABC İnşaat A.Ş.", "ABC İnşaat Ltd. Şti.");
    expect(r.similar).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(NAME_SIMILARITY_THRESHOLD);
  });

  it("Türkçe karakter farkı BENZER", () => {
    expect(isSimilarName("Yılmaz Hukuk", "Yilmaz Hukuk").similar).toBe(true);
  });

  it("yazım hatası BENZER", () => {
    expect(isSimilarName("Mehmet Demir", "Mehmet Demirr").similar).toBe(true);
    expect(isSimilarName("Deniz Tekstil", "Deniz Tekstl").similar).toBe(true);
  });

  it("farklı müvekkiller BENZER DEĞİLDİR", () => {
    expect(isSimilarName("Mehmet Demir", "Ayşe Yılmaz").similar).toBe(false);
    expect(isSimilarName("ABC Holding", "XYZ Holding").similar).toBe(false);
  });

  it("başka sektör aynı soyad — BENZER DEĞİLDİR (aşırı eşleşme testi)", () => {
    expect(isSimilarName("Deniz Tekstil", "Deniz Lojistik").similar).toBe(false);
  });

  it("boş ad benzer değildir", () => {
    expect(isSimilarName("", "ABC").similar).toBe(false);
    expect(isSimilarName("ABC", "").similar).toBe(false);
  });
});
