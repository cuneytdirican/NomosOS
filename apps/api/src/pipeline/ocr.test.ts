/**
 * OCR (Faz 1): PDF'ten gömülü JPEG akışı ayıklama, paylaşımlı worker ile
 * sayfa tanıma, text-extract entegrasyonu (görsel + taranmış PDF), kapatma.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { __setOcrWorkerForTests, extractJpegStreamsFromPdf, ocrImages } from "./ocr";
import { extractText } from "./text-extract";

/** Sahte tarayıcı PDF'i: iki DCTDecode akışı (her biri JPEG SOI ile başlar). */
function fakeScannedPdf(pages = 2): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  for (let i = 0; i < pages; i++) {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, i + 1), Buffer.from([0xff, 0xd9])]);
    parts.push(Buffer.from(`${i + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\r\n`));
    parts.push(jpeg);
    parts.push(Buffer.from("\r\nendstream\nendobj\n"));
  }
  parts.push(Buffer.from("%%EOF\n"));
  return Buffer.concat(parts);
}

const fakeWorker = (texts: string[]) => {
  let n = 0;
  return {
    recognize: vi.fn(async () => ({ data: { text: texts[n++] ?? "", confidence: 88 } })),
    terminate: vi.fn(async () => undefined),
  };
};

afterEach(() => {
  __setOcrWorkerForTests(null);
  delete process.env.OCR_ENABLED;
});

describe("extractJpegStreamsFromPdf", () => {
  it("DCTDecode akışlarını sırayla ayıklar; JPEG olmayan/küçük akışları atlar", () => {
    const pdf = fakeScannedPdf(3);
    const imgs = extractJpegStreamsFromPdf(pdf);
    expect(imgs).toHaveLength(3);
    expect(imgs[0][0]).toBe(0xff);
    expect(imgs[0][1]).toBe(0xd8);
    expect(extractJpegStreamsFromPdf(pdf, 2)).toHaveLength(2);
    expect(extractJpegStreamsFromPdf(Buffer.from("%PDF-1.4 metin katmanli, resim yok"))).toHaveLength(0);
  });
});

describe("ocrImages + text-extract", () => {
  it("görsel belge OCR ile TAMAM olur (metin worker'dan)", async () => {
    __setOcrWorkerForTests(fakeWorker(["Fesih bildirimi: kıdeminiz 7 yıl 2 ay olduğundan ihbar süreniz 8 haftadır."]));
    const r = await extractText({ buffer: Buffer.alloc(5000, 1), mimeType: "image/jpeg", fileName: "tebligat.jpg" });
    expect(r.outcome).toBe("TAMAM");
    expect(r.text).toContain("ihbar süreniz 8 haftadır");
    expect(r.note).toMatch(/OCR/);
  });

  it("taranmış PDF: gömülü JPEG sayfaları OCR'lanır, sayfa sayısı ve güven notu yazılır", async () => {
    __setOcrWorkerForTests(fakeWorker(["Sayfa bir metni burada, tebliğ tarihi 12.05.2026 olarak görünmektedir.", "Sayfa iki metni: bilirkişi raporuna itiraz süresi iki haftadır."]));
    const r = await extractText({ buffer: fakeScannedPdf(2), mimeType: "application/pdf", fileName: "tarama.pdf" });
    expect(r.outcome).toBe("TAMAM");
    expect(r.text).toContain("Sayfa bir");
    expect(r.text).toContain("Sayfa iki");
    expect(r.pageCount).toBe(2);
    expect(r.note).toMatch(/OCR.*2 sayfa/);
  });

  it("OCR kapalıysa taranmış PDF dürüstçe BASARISIZ kalır; JPEG'siz tarama da BASARISIZ", async () => {
    process.env.OCR_ENABLED = "false";
    const off = await extractText({ buffer: fakeScannedPdf(1), mimeType: "application/pdf", fileName: "t.pdf" });
    expect(off.outcome).toBe("BASARISIZ");
    expect(off.note).toMatch(/OCR/);
    delete process.env.OCR_ENABLED;
    __setOcrWorkerForTests(fakeWorker(["x"]));
    const noJpeg = await extractText({ buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Filter /CCITTFaxDecode >> stream\r\nabc\r\nendstream\n"), mimeType: "application/pdf", fileName: "t.pdf" });
    expect(noJpeg.outcome).toBe("BASARISIZ");
    expect(noJpeg.note).toMatch(/JPEG/);
  });

  it("worker boş metin dönerse BASARISIZ (uydurma yok)", async () => {
    __setOcrWorkerForTests(fakeWorker(["", ""]));
    const r = await extractText({ buffer: fakeScannedPdf(2), mimeType: "application/pdf", fileName: "bos.pdf" });
    expect(r.outcome).toBe("BASARISIZ");
    const pages = await ocrImages([Buffer.alloc(10), Buffer.alloc(10)]);
    expect(pages).toHaveLength(2);
  });
});
