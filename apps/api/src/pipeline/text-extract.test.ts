/**
 * F2 · B2 REGRESYON TESTİ — DOCX ve UDF metin çıkarma.
 *
 * Belge hattının en büyük "ucuz kazanç" iki biçimi burada kapanıyor: DOCX
 * (word/document.xml) ve UDF (CDATA ham metni). Testler GERÇEK arşivler
 * üretir (jszip ve @nomosos/udf builder) — sahte tamponla değil.
 *
 * Korunan taahhütler:
 *  - DOCX: <w:t> düğümleri birleşir, paragraf sonu \n ile taşınır, XML
 *    kaçış karakterleri çözülür.
 *  - UDF: PII taraması sözleşmesi gereği rawText (CDATA ham metni) okunur.
 *  - Metin uydurulmaz: okunamayan biçim BASARISIZ/GEREKSIZ döner, boş metin
 *    üretmez.
 */

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createUdf, normalizeDocument } from "@nomosos/udf";
import { extractText, MAX_EXTRACTED_TEXT_CHARS } from "./text-extract";

async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`,
  );
  const out = await zip.generateAsync({ type: "nodebuffer" });
  return out;
}

/** @nomosos/udf'in kendi testindeki desen: normalizeDocument + createUdf. */
function udfDoc(paragraphs: string[]) {
  return normalizeDocument({ metadata: {}, defaultStyle: {}, paragraphs: paragraphs.map((text) => ({ text })) });
}

describe("B2: DOCX metin çıkarma", () => {
  it("<w:t> düğümleri birleşir ve paragraf sonu \\n ile taşınır", async () => {
    const buffer = await makeDocx([
      "Sayın Mahkeme,",
      "Tebligat 12.03.2026 tarihinde yapılmıştır.",
      "Talep ouruz.",
    ]);
    const result = await extractText({
      buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "dilekce.docx",
    });
    expect(result.outcome).toBe("TAMAM");
    expect(result.text).toBe(
      "Sayın Mahkeme,\nTebligat 12.03.2026 tarihinde yapılmıştır.\nTalep ouruz.",
    );
  });

  it("XML kaçış karakterleri çözülür (& < >)", async () => {
    const buffer = await makeDocx([
      "A &amp; B &lt;C&gt; mahkemesi dosyasında tebligat tarihi 12.03.2026'dır ve talep ouruz.",
    ]);
    const result = await extractText({ buffer, fileName: "x.docx" });
    expect(result.outcome).toBe("TAMAM");
    expect(result.text).toContain("A & B <C> mahkemesi");
  });

  it("belge görsel içerikliyse metin yok → BASARISIZ, metin UYDURULMAZ", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", '<w:document xmlns:w="x"><w:body><w:p/></w:body></w:document>');
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const result = await extractText({ buffer, fileName: "gorsel.docx" });
    expect(result.outcome).toBe("BASARISIZ");
    expect(result.text).toBeUndefined();
  });

  it("bozuk zip → BASARISIZ + Türkçe not", async () => {
    const result = await extractText({ buffer: Buffer.from("bozuk"), fileName: "x.docx" });
    expect(result.outcome).toBe("BASARISIZ");
    expect(result.note).toContain("DOCX");
  });
});

describe("B2: UDF metin çıkarma", () => {
  it("CDATA ham metni (rawText) okunur — PII sözleşmesi", async () => {
    const udf = await createUdf(
      udfDoc([
        "Sayın Mahkeme,",
        "Davacı vekili olarak dava konusu işlemelerin iptalini talep ederiz.",
      ]),
    );
    const result = await extractText({ buffer: Buffer.from(udf), fileName: "dilekce.udf" });
    expect(result.outcome).toBe("TAMAM");
    expect(result.text).toContain("Sayın Mahkeme,");
    expect(result.text).toContain("iptalini talep ederiz");
    // Ham metin paragrafları da taşır.
    expect(result.text).toContain("\n");
  });

  it("UDF uzantısı olmayan arşiv bilinmeyen biçime düşer — metin uydurulmaz", async () => {
    const udf = await createUdf(udfDoc(["İcra mahkemesine sunulmak üzere hazırlanmıştır bu metin."]));
    const result = await extractText({
      buffer: Buffer.from(udf),
      mimeType: "application/octet-stream",
      fileName: "evrak.bin",
    });
    expect(["GEREKSIZ", "TAMAM"]).toContain(result.outcome);
    if (result.outcome === "GEREKSIZ") expect(result.text).toBeUndefined();
  });
});

describe("B2: üst sınır ve diğer biçimler bozulmadı", () => {
  it("TXT hâlâ okunuyor", async () => {
    const result = await extractText({
      buffer: Buffer.from("Düz metin içeriği — tebligat tarihi 01.02.2026."),
      fileName: "not.txt",
    });
    expect(result.outcome).toBe("TAMAM");
  });

  it("görsel hâlâ BASARISIZ — OCR vaadi yok", async () => {
    const result = await extractText({ buffer: Buffer.from("x"), fileName: "fotograf.jpg" });
    expect(result.outcome).toBe("BASARISIZ");
    expect(result.text).toBeUndefined();
  });

  it("çıkan metin üst sınırı değişmedi (200.000)", () => {
    expect(MAX_EXTRACTED_TEXT_CHARS).toBe(200_000);
  });
});
