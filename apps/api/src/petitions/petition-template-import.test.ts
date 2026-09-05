/**
 * FAZ 7D — büro dilekçe şablonu içe aktarma sezgisi (deterministik, AI yok).
 */

import { describe, expect, it } from "vitest";
import { isHeadingParagraph, paragraphsToTemplateSections, templateKeyFromName } from "./petition-template-import";

describe("Faz 7D: başlık sezgisi", () => {
  it("büyük harfli kısa satır ve bilinen başlıklar başlıktır; cümleler değildir", () => {
    expect(isHeadingParagraph("AÇIKLAMALAR")).toBe(true);
    expect(isHeadingParagraph("SONUÇ VE İSTEM:")).toBe(true);
    expect(isHeadingParagraph("1- Hukuki Nedenler")).toBe(true);
    expect(isHeadingParagraph("Deliller:")).toBe(true);
    expect(isHeadingParagraph("Davacı müvekkil ile davalı arasında 12.03.2024 tarihli sözleşme imzalanmıştır.")).toBe(false);
    expect(isHeadingParagraph("İSTANBUL 12. İŞ MAHKEMESİ SAYIN HÂKİMLİĞİNE, DAVACI VEKİLİ OLARAK SUNULAN DİLEKÇEMİZDİR VE DEVAMI GELİR.")).toBe(false);
    expect(isHeadingParagraph("")).toBe(false);
  });
});

describe("Faz 7D: paragraf → bölüm", () => {
  it("başlık öncesi künye atılır; gövde ipucu olur; ilk ve son (istem) bölüm zorunlu", () => {
    const sections = paragraphsToTemplateSections([
      "İSTANBUL 12. İŞ MAHKEMESİ SAYIN HÂKİMLİĞİNE",
      "DAVACI: Ayşe Yılmaz (TCKN 12345678901)",
      "KONU",
      "İşçilik alacaklarının tahsili talebidir.",
      "AÇIKLAMALAR",
      "1. Müvekkil 2019'dan beri davalı işyerinde çalışmıştır.",
      "2. İş akdi haksız feshedilmiştir.",
      "HUKUKİ NEDENLER:",
      "İş Kanunu, HMK ve ilgili mevzuat.",
      "SONUÇ VE İSTEM",
      "Davanın kabulünü talep ederiz.",
    ]);
    expect(sections.map((s) => s.title)).toEqual(["KONU", "AÇIKLAMALAR", "HUKUKİ NEDENLER", "SONUÇ VE İSTEM"]);
    expect(sections[0].required).toBe(true);
    expect(sections[1].required).toBe(false);
    expect(sections[3].required).toBe(true);
    expect(sections[1].hint).toContain("2. İş akdi haksız feshedilmiştir.");
    expect(JSON.stringify(sections)).not.toContain("12345678901");
  });

  it("hiç başlık yoksa tek İÇERİK bölümü", () => {
    const s = paragraphsToTemplateSections(["Sadece düz metin bir paragraf.", "İkinci paragraf."]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ title: "İÇERİK", required: true });
    expect(s[0].hint).toContain("İkinci paragraf.");
  });

  it("anahtar üretimi Türkçe karakterleri katlar", () => {
    expect(templateKeyFromName("Bizim Cevap Dilekçemiz (Şubat)")).toBe("BURO_BIZIM_CEVAP_DILEKCEMIZ_SUBAT");
    expect(templateKeyFromName("!!!")).toBe("BURO_SABLON");
  });
});
