import { describe, expect, it } from "vitest";
import { foldTurkishPreservingLength, maskTerms } from "@nomosos/ai";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ SÖZLÜK MASKESİ — TİCARET UNVANI KAÇAĞI (canlı doğrulama bulgusu)         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * K-07/Ö-22 düzeltmesi canlı doğrulandı: TCKN maskeleniyor, "Müvekkil:" ve
 * "Taraflar:" satırları etiketleniyor, 409 kapısı ağ çağrısından ÖNCE düşüyor.
 * Ama yakalama sunucusuna GERÇEKTEN giden gövde şunu içeriyordu:
 *
 *     Dosya: ABC Holding / XYZ İnşaat — Alacak davası (DAVA / DERDEST)
 *     ...
 *     Müvekkil: [MÜVEKKİL]
 *     - DAVALI: [TARAF-2]
 *
 * Yani bağlamın İLK SATIRI, iki satır aşağıda özenle maskelenen kimlikleri
 * açıkça taşıyordu. Sebep: sözlük yalnız TAM eşleşme arıyordu — kayıtlar
 * "ABC Holding A.Ş." ve "XYZ İnşaat Ltd. Şti.", dosya başlığı ise kısa
 * ticaret adını kullanıyor.
 *
 * Testler hem kaçağı hem de düzeltmenin SINIRINI (fazla maskeleme yapmaması)
 * kilitler.
 */
describe("maskTerms — ticaret unvanı ekleri (canlı doğrulama kaçağı)", () => {
  const terms = [
    { value: "ABC Holding A.Ş.", label: "[MÜVEKKİL]" },
    { value: "XYZ İnşaat Ltd. Şti.", label: "[TARAF-2]" },
  ];

  it("dosya başlığındaki KISA ticaret adını da maskeler", () => {
    const line = "Dosya: ABC Holding / XYZ İnşaat — Alacak davası (DAVA / DERDEST)";
    const { maskedText } = maskTerms(line, terms);

    // YARIM MASKE DE KABUL EDİLMEZ: "[MÜVEKKİL] Holding" hâlâ kimliğe işaret
    // eder ve ilk denemede tam olarak bu çıkmıştı (yalnız en kısa çekirdek
    // sözlüğe konduğu için). Beklenen çıktı tam etikettir.
    expect(maskedText).toBe("Dosya: [MÜVEKKİL] / [TARAF-2] — Alacak davası (DAVA / DERDEST)");
    expect(maskedText).not.toMatch(/ABC|XYZ|Holding|İnşaat/);
  });

  it("tam unvan da eskisi gibi maskelenir (regresyon)", () => {
    const { maskedText } = maskTerms("Davacı ABC Holding A.Ş. vekili beyanda bulundu.", terms);
    expect(maskedText).toContain("[MÜVEKKİL]");
    expect(maskedText).not.toContain("ABC Holding");
  });

  it("aynı terimin iki varyantı sayacı ŞİŞİRMEZ", () => {
    // `replaced` denetim izine (`AiUsageLog.piiMasked`) girdiği için
    // varyant başına değil, TERİM başına sayılmalıdır.
    const { replaced } = maskTerms("ABC Holding A.Ş. ile ABC Holding aynı kişidir.", [terms[0]]);
    expect(replaced).toBe(1);
  });

  it("çekirdek 3 karakterden kısaysa varyant üretilmez (yanlış pozitif kapısı)", () => {
    // "Ay Ltd. Şti." → çekirdek "Ay"; metindeki sıradan "Ay" kelimeleri
    // delinmemelidir.
    const { maskedText } = maskTerms("Ay sonunda duruşma var; ayrıca dosya incelendi.", [
      { value: "Ay Ltd. Şti.", label: "[TARAF-1]" },
    ]);
    expect(maskedText).toBe("Ay sonunda duruşma var; ayrıca dosya incelendi.");
  });

  it("ek taşımayan gerçek kişi adları etkilenmez", () => {
    const { maskedText } = maskTerms("Mehmet Demir ifade verdi.", [
      { value: "Mehmet Demir", label: "[MÜVEKKİL]" },
    ]);
    expect(maskedText).toBe("[MÜVEKKİL] ifade verdi.");
  });

  it("TÜRKÇE KLAVYE KULLANILMADAN yazılan adı da maskeler", () => {
    // Avukat soru kutusuna "XYZ Insaat Ltd. Sti." yazar; kayıt
    // "XYZ İnşaat Ltd. Şti."dir. Tam eşleşme bunu ıskalıyordu ve karşı tarafın
    // unvanı dış sağlayıcıya AÇIK gidiyordu (canlı yakalandı).
    const { maskedText } = maskTerms(
      "XYZ Insaat Ltd. Sti. ile gorusuldu; ayrica XYZ İnşaat dosyasi acildi.",
      terms,
    );
    expect(maskedText).not.toMatch(/XYZ/);
    expect(maskedText).toContain("[TARAF-2]");
  });

  it("aksan katlama metnin UZUNLUĞUNU değiştirmez (indis kayması olmaz)", () => {
    // "İ" gibi karakterlerde `toLowerCase()` iki kod birimi üretir; uzunluk
    // kayarsa maske yanlış karakterleri yer.
    for (const sample of ["İIıiŞşĞğÜüÖöÇç", "ABC Holding A.Ş.", "Mehmet Demir"]) {
      expect(foldTurkishPreservingLength(sample)).toHaveLength(sample.length);
    }
    // Uçtan uca: aksanlı terimden SONRA gelen metin bozulmadan kalmalı.
    const { maskedText } = maskTerms("İşbu dosyada XYZ İnşaat Ltd. Şti. davalıdır.", terms);
    expect(maskedText).toBe("İşbu dosyada [TARAF-2] davalıdır.");
  });

  it("uzun terim kısa terimden ÖNCE uygulanır (yarım maske olmaz)", () => {
    const { maskedText } = maskTerms("Yılmaz İnşaat Ltd. Şti. ve Yılmaz ayrı kişilerdir.", [
      { value: "Yılmaz İnşaat Ltd. Şti.", label: "[TARAF-1]" },
      { value: "Yılmaz", label: "[MÜVEKKİL]" },
    ]);
    expect(maskedText).toBe("[TARAF-1] ve [MÜVEKKİL] ayrı kişilerdir.");
  });
});
