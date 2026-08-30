import { describe, expect, it } from "vitest";

import { readUdf } from "../parser";
import {
  EVIDENCE_PLACEHOLDER,
  LEGAL_GROUNDS_PLACEHOLDER,
  PETITION_SECTION_ORDER,
  PETITION_SECTION_TITLES,
  buildPetitionDocument,
  createPetitionUdf,
  formatPetitionDate,
} from "../petition-template";
import type { PetitionInput } from "../petition-template";
import { udfToPlainText } from "../index";

const input: PetitionInput = {
  courtName: "Ankara 3. Asliye Hukuk Mahkemesi",
  caseNumber: "2026/1234",
  plaintiffs: [
    { name: "Ahmet Yılmaz", identityNumber: "12345678901", address: "Çankaya/ANKARA" },
  ],
  defendants: [{ name: "Örnek İnşaat A.Ş.", identityNumber: "9876543210" }],
  attorney: { name: "Ayşe Demir", barName: "Ankara Barosu", barNumber: "1234" },
  subject: "Fazlaya ilişkin haklarımız saklı kalmak kaydıyla alacak talebimizdir.",
  explanations: [
    "Müvekkil ile davalı arasında 01.02.2026 tarihli sözleşme imzalanmıştır.",
    "Davalı, edimini süresinde ifa etmemiştir.",
  ],
  request: "Davanın kabulü ile alacağın davalıdan tahsiline karar verilmesini arz ve talep ederiz.",
  date: new Date(2026, 7, 30),
  signerTitle: "Davacı Vekili",
};

describe("buildPetitionDocument", () => {
  it("standart dilekçe bölüm başlıklarının tamamını içerir", () => {
    const text = udfToPlainText(buildPetitionDocument(input));
    expect(text).toContain(`${PETITION_SECTION_TITLES.subject}:`);
    expect(text).toContain(`${PETITION_SECTION_TITLES.explanations}:`);
    expect(text).toContain(`${PETITION_SECTION_TITLES.legalGrounds}:`);
    expect(text).toContain(`${PETITION_SECTION_TITLES.evidence}:`);
    expect(text).toContain(`${PETITION_SECTION_TITLES.request}:`);
  });

  it("bölümleri standart sırada üretir", () => {
    const text = udfToPlainText(buildPetitionDocument(input));
    const positions = PETITION_SECTION_ORDER.map((title) => text.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it("mahkeme başlığını T.C. ve hitap satırıyla ortalar", () => {
    const doc = buildPetitionDocument(input);
    expect(doc.paragraphs[0].text).toBe("T.C.");
    expect(doc.paragraphs[1].text).toBe(input.courtName.toLocaleUpperCase("tr-TR"));
    expect(doc.paragraphs[2].text).toBe("SAYIN HÂKİMLİĞİ'NE");
    expect(doc.paragraphs.slice(0, 3).every((p) => p.layout?.alignment === "center")).toBe(true);
  });

  it("taraf ve vekil bilgilerini etiketli satırlar hâlinde yazar", () => {
    const text = udfToPlainText(buildPetitionDocument(input));
    expect(text).toContain("ESAS NO: 2026/1234");
    expect(text).toContain("DAVACI: Ahmet Yılmaz (T.C. Kimlik No: 12345678901)");
    expect(text).toContain("VEKİLİ: Av. Ayşe Demir (Ankara Barosu, Sicil No: 1234)");
    expect(text).toContain("DAVALI: Örnek İnşaat A.Ş.");
    expect(text).toContain("Çankaya/ANKARA");
  });

  it("etiketleri kalın run olarak işaretler", () => {
    const doc = buildPetitionDocument(input);
    const konu = doc.paragraphs.find((p) => p.text.startsWith("KONU: "));
    expect(konu).toBeDefined();
    expect(konu?.runs?.[0]).toEqual({ startOffset: 0, length: 6, style: { bold: true } });
  });

  it("hukuki sebep ve delil verilmediğinde dayanak UYDURMAZ, görünür yer tutucu bırakır", () => {
    // Sistem, mahkemeye giden metne kendi hukuki sebebini yazmaz: icra/idari/ceza
    // dilekçelerinde "HMK, TBK…" dayanağı yanlış olurdu (denetim bulgusu 16).
    const text = udfToPlainText(buildPetitionDocument(input));
    expect(text).toContain(LEGAL_GROUNDS_PLACEHOLDER);
    expect(text).toContain(EVIDENCE_PLACEHOLDER);
    expect(text).not.toContain("HMK, TBK ve ilgili sair mevzuat hükümleri.");
  });

  it("dilekçe tarihini sunucu saat diliminden değil TR saatinden üretir", () => {
    // 2026-08-30T23:30:00Z → TR saatiyle 31.08.2026 (UTC sunucuda 30.08 yazardı).
    expect(formatPetitionDate(new Date("2026-08-30T23:30:00Z"))).toBe("31.08.2026");
    expect(formatPetitionDate(new Date("2026-01-01T00:30:00Z"))).toBe("01.01.2026");
    expect(formatPetitionDate("14.02.2026")).toBe("14.02.2026");
  });

  it("açıklama ve delilleri numaralandırır", () => {
    const doc = buildPetitionDocument({
      ...input,
      evidence: ["Sözleşme", "Ticari defterler"],
      attachments: ["Vekaletname"],
    });
    const text = udfToPlainText(doc);
    expect(text).toContain("1- Müvekkil ile davalı arasında");
    expect(text).toContain("2- Davalı, edimini süresinde ifa etmemiştir.");
    expect(text).toContain("1- Sözleşme");
    expect(text).toContain("2- Ticari defterler");
    expect(text).toContain(`${PETITION_SECTION_TITLES.attachments}:`);
    expect(text).toContain("1- Vekaletname");
  });

  it("tarih ve imza bloğunu sağa yaslar", () => {
    const doc = buildPetitionDocument(input);
    const tail = doc.paragraphs.slice(-4);
    expect(tail.map((p) => p.text)).toEqual([
      "30.08.2026",
      "Davacı Vekili",
      "Av. Ayşe Demir",
      "(İmza)",
    ]);
    expect(tail.every((p) => p.layout?.alignment === "right")).toBe(true);
  });

  it("formatPetitionDate tarihi GG.AA.YYYY biçiminde yazar", () => {
    // Sabit bir ana bağlanır: sonuç, testi koşan makinenin saat diliminden BAĞIMSIZDIR.
    expect(formatPetitionDate(new Date("2026-01-05T09:00:00Z"))).toBe("05.01.2026");
    expect(formatPetitionDate("01.09.2026")).toBe("01.09.2026");
  });
});

describe("createPetitionUdf", () => {
  it("UDF üretir ve geri okunduğunda bölüm başlıkları korunur", async () => {
    const bytes = await createPetitionUdf(input);
    expect(bytes.byteLength).toBeGreaterThan(0);
    const parsed = await readUdf(bytes);
    const text = udfToPlainText(parsed);
    for (const title of PETITION_SECTION_ORDER) {
      expect(text).toContain(title);
    }
    expect(text).toContain("Av. Ayşe Demir");
    expect(text).toContain("HÂKİMLİĞİ");
  });
});
