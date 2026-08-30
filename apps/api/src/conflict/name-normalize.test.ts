/**
 * AD NORMALİZASYONU VE BENZERLİK — birim testleri.
 *
 * Bu fonksiyonlar çıkar çatışması taramasının BİRİNCİ ve tek belirleyici
 * katmanıdır; sonuçları avukatın vekâlet alıp almayacağını etkiler. Hiçbiri
 * LLM kullanmaz, dolayısıyla tamamı deterministik olarak test edilebilir.
 */

import { describe, expect, it } from "vitest";
import { foldTurkish, levenshtein, nameSimilarity, normalizeName, roundSimilarity } from "./name-normalize";

describe("foldTurkish", () => {
  it("Türkçe I/İ ayrımını doğru katlar — toLowerCase() tek başına yetmez", () => {
    // JS varsayılan yerelinde "I".toLowerCase() === "i"dir; Türkçede "ı"dır.
    // İki yazım da aynı sepete düşmelidir.
    expect(foldTurkish("IŞIK")).toBe(foldTurkish("Işık"));
    expect(foldTurkish("İSTANBUL")).toBe(foldTurkish("istanbul"));
  });

  it("ş/ğ/ü/ö/ç harflerini ASCII'ye indirger", () => {
    expect(foldTurkish("ÇĞÖŞÜ")).toBe("cgosu");
  });
});

describe("normalizeName", () => {
  it("hukuki biçim eklerini atar — aynı tüzel kişi aynı ada iner", () => {
    expect(normalizeName("XYZ Gıda San. ve Tic. A.Ş.")).toBe(normalizeName("XYZ Gıda"));
  });

  it("SEKTÖR SÖZCÜĞÜNÜ KORUR — 'ABC Holding' ile 'ABC İnşaat' aynı değildir", () => {
    // Bu ayrım kasıtlıdır: sektör sözcüğü atılsaydı birbirinden bağımsız iki
    // şirket %100 benzerlikle eşleşir ve tarama yanlış pozitif üretirdi.
    // Grup/bağlı şirket ilişkisi yalnız AI çıkarım katmanının "olası" bulgusudur.
    expect(normalizeName("ABC Holding")).not.toBe(normalizeName("ABC İnşaat"));
  });

  it("noktalama ve fazla boşluğu sadeleştirir", () => {
    expect(normalizeName("  Ahmet   Yılmaz  ")).toBe(normalizeName("Ahmet Yılmaz"));
  });
});

describe("levenshtein", () => {
  it("aynı metinde 0", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("boş metinde diğerinin uzunluğu", () => {
    expect(levenshtein("", "abcd")).toBe(4);
    expect(levenshtein("abcd", "")).toBe(4);
  });

  it("tek harf değişimini 1 sayar", () => {
    expect(levenshtein("kitap", "kitab")).toBe(1);
  });
});

describe("nameSimilarity", () => {
  it("birebir aynı ad 1.0 verir (yazım farkları katlandıktan sonra)", () => {
    expect(nameSimilarity("ABC Holding A.Ş.", "ABC Holding")).toBe(1);
  });

  it("alakasız adlarda ÇAKIŞMA eşiğinin (0,90) çok altında kalır", () => {
    expect(nameSimilarity("ABC Holding", "Zeynep Kaya")).toBeLessThan(0.5);
  });

  it("0 ile 1 aralığının dışına çıkmaz", () => {
    const values = [
      nameSimilarity("", ""),
      nameSimilarity("a", ""),
      nameSimilarity("ABC", "ABC İnşaat Sanayi ve Ticaret Limited Şirketi"),
    ];
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("SİMETRİKTİR — taranan ile indeksteki kaydın sırası sonucu değiştirmez", () => {
    expect(nameSimilarity("ABC Gıda", "ABC Gida A.Ş.")).toBe(
      nameSimilarity("ABC Gida A.Ş.", "ABC Gıda"),
    );
  });
});

describe("roundSimilarity", () => {
  it("eşik karşılaştırmaları kararlı olsun diye sabit basamağa yuvarlar", () => {
    const r = roundSimilarity(0.876543);
    expect(r).toBe(roundSimilarity(r));
  });
});
