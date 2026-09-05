/**
 * FAZ 6 — UYAP kuyruğundan dosya oluşturma (saf yardımcılar).
 *
 *  1. Dosya türü çıkarımı birim adından: İcra Dairesi → ICRA, Ceza → CEZA, Arabuluculuk → ARABULUCULUK, aksi DAVA.
 *  2. Takip türü çıkarımı UYAP metninden: kambiyo/ilamlı/rehin/ipotek/nafaka/tahliye; belirsiz → ILAMSIZ.
 *  3. Tahmin/uydurma yok: bilinmeyen metin en genel türe düşer, hata üretmez.
 */

import { describe, expect, it } from "vitest";
import { inferCaseType, trackingTypeFrom } from "./uyap.service";

describe("Faz 6: inferCaseType", () => {
  it("birim adından tür", () => {
    expect(inferCaseType("Ankara 7. İcra Dairesi", "")).toBe("ICRA");
    expect(inferCaseType("İstanbul 3. Ağır Ceza Mahkemesi", "")).toBe("CEZA");
    expect(inferCaseType("Arabuluculuk Bürosu", "")).toBe("ARABULUCULUK");
    expect(inferCaseType("İstanbul 12. İş Mahkemesi", "Hukuk Dava Dosyası")).toBe("DAVA");
  });

  it("ASCII büyük I ile yazılmış 'Icra' da yakalanır (tr-TR küçültme I → ı tuzağı)", () => {
    expect(inferCaseType("Ankara 7. Icra Dairesi", "")).toBe("ICRA");
    expect(inferCaseType("ANKARA 7. İCRA DAİRESİ", "")).toBe("ICRA");
    expect(trackingTypeFrom("ILAMLI TAKIP")).toBe("ILAMLI");
    expect(trackingTypeFrom("Ilamsiz Takip")).toBe("ILAMSIZ");
  });

  it("dosya türü metni birim adını tamamlar", () => {
    expect(inferCaseType("", "İcra Dosyası")).toBe("ICRA");
    expect(inferCaseType("", "Ceza Dava Dosyası")).toBe("CEZA");
  });
});

describe("Faz 6: trackingTypeFrom", () => {
  it("UYAP takip türü metni → NomosOS takip türü", () => {
    expect(trackingTypeFrom("Kambiyo Senetlerine Özgü Haciz Yolu")).toBe("KAMBIYO");
    expect(trackingTypeFrom("İlamlı Takip")).toBe("ILAMLI");
    expect(trackingTypeFrom("İlamsız Takip (Genel Haciz Yolu)")).toBe("ILAMSIZ");
    expect(trackingTypeFrom("Rehnin Paraya Çevrilmesi")).toBe("REHNIN_PARAYA_CEVRILMESI");
    expect(trackingTypeFrom("İpoteğin Paraya Çevrilmesi")).toBe("IPOTEGIN_PARAYA_CEVRILMESI");
    expect(trackingTypeFrom("Nafaka Alacağı")).toBe("NAFAKA");
    expect(trackingTypeFrom("Tahliye Takibi")).toBe("TAHLIYE");
  });

  it("belirsiz/boş metin → ILAMSIZ (en genel yol); hata yok", () => {
    expect(trackingTypeFrom(null)).toBe("ILAMSIZ");
    expect(trackingTypeFrom("")).toBe("ILAMSIZ");
    expect(trackingTypeFrom("Bilinmeyen Takip")).toBe("ILAMSIZ");
  });
});
