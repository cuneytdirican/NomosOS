/**
 * Adım 1 — METİN ÇIKARMA.
 *
 * KURAL: METİN UYDURULMAZ. Bir biçimden metin çıkarılamıyorsa sonuç açıkça
 * BASARISIZ/GEREKSIZ işaretlenir ve nedeni Türkçe yazılır. Sonraki adımlar
 * (sınıflandırma, süre tespiti) metin yoksa ATLANIR — "boş metinden sınıf
 * uydurmak" halüsinasyonun en ucuz yoludur.
 *
 * Kapsam (F2 · B2 ile DOCX ve UDF eklendi):
 *   - PDF  → pdf-parse (gömülü metin katmanı). Taranmış PDF'te metin katmanı
 *            yoktur; bu durumda gerçek OCR gerekir → BASARISIZ + açık not.
 *   - TXT  → doğrudan UTF-8.
 *   - DOCX → word/document.xml içindeki <w:t> metin düğümleri (F2 · B2).
 *   - Görsel (JPEG/PNG) → gerçek OCR yok → BASARISIZ + açık not
 *            (taranmış görüntü için OCR henüz kurulmadı; yanlış metin
 *            üretmemek sessiz kalmaktan iyidir).
 *   - UDF  → @nomosos/udf parser'ı, CDATA ham metni (rawText) (F2 · B2).
 */

import { readUdf } from "@nomosos/udf";

export type TextExtractOutcome = "TAMAM" | "BASARISIZ" | "GEREKSIZ";

export interface TextExtractResult {
  outcome: TextExtractOutcome;
  text?: string;
  pageCount?: number;
  /** Kullanıcıya gösterilecek Türkçe açıklama (her sonuçta doludur). */
  note: string;
}

/** Metin katmanı bu uzunluğun altındaysa PDF taranmış kabul edilir. */
const MIN_MEANINGFUL_TEXT_LENGTH = 40;

/** LLM'e ve DB'ye taşınan metin üst sınırı (yaklaşık 60 sayfa). */
export const MAX_EXTRACTED_TEXT_CHARS = 200_000;

/**
 * Tek PDF'te ayrıştırılacak azami sayfa.
 *
 * Sınır olmadan 3000 sayfalık bir dosya tek istekte ayrıştırılıyor ve bellek
 * pdf-parse'ın ara yapılarıyla katlanıyordu. Aşıldığında KISMİ metin döner ve
 * durum kullanıcıya bildirilir — sessizce kesilmez.
 */
export const MAX_PDF_PAGES = Number.parseInt(process.env.MAX_PDF_PAGES ?? "", 10) || 300;

export async function extractText(params: {
  buffer: Buffer;
  mimeType?: string | null;
  fileName: string;
}): Promise<TextExtractResult> {
  const kind = detectKind(params.mimeType, params.fileName);

  switch (kind) {
    case "pdf":
      return extractFromPdf(params.buffer);
    case "txt":
      return extractFromTxt(params.buffer);
    case "docx":
      // F2 · B2: "ucuz kazanç" — DOCX bir zip'tir; word/document.xml içindeki
      // <w:t> düğümleri belgenin metin katmanıdır. Yeni bağımlılık: jszip
      // (paket zaten @nomosos/udf üzerinden bağımlılık ağacındaydı).
      return extractFromDocx(params.buffer);
    case "image":
      return {
        outcome: "BASARISIZ",
        note:
          "Görsel belgelerde OCR henüz kurulu değil. " +
          "Belge saklandı; metni okunamadığı için sınıflandırma ve süre tespiti yapılmadı. " +
          "Metin katmanı olan bir PDF yüklerseniz hat tam çalışır.",
      };
    case "udf":
      // F2 · B2: UDF arşivi @nomosos/udf ile ayrıştırılır. PII taraması ve
      // indeksleme DAİMA ham CDATA metni (rawText) üzerinden yapılır.
      return extractFromUdf(params.buffer);
    default:
      return {
        outcome: "GEREKSIZ",
        note: `Bu biçimden (${params.mimeType ?? "bilinmiyor"}) metin çıkarma desteklenmiyor.`,
      };
  }
}

async function extractFromPdf(buffer: Buffer): Promise<TextExtractResult> {
  try {
    const { default: pdfParse } = await import("pdf-parse");
    // SAYFA TAVANI: sınır olmadan 3000 sayfalık bir PDF tek istekte
    // ayrıştırılıyordu (pdf-parse'ın ara yapıları belleği katlar). Tavanı aşan
    // belgeden KISMİ metin çıkarılır ve durum kullanıcıya AÇIKÇA bildirilir.
    const parsed = await pdfParse(buffer, { max: MAX_PDF_PAGES });
    const text = normalizeWhitespace(parsed.text ?? "");
    const truncatedByPages = (parsed.numpages ?? 0) > MAX_PDF_PAGES;

    if (text.length < MIN_MEANINGFUL_TEXT_LENGTH) {
      return {
        outcome: "BASARISIZ",
        pageCount: parsed.numpages,
        note:
          "PDF'te okunabilir metin katmanı bulunamadı (büyük olasılıkla taranmış görüntü). " +
          "Görüntü OCR'ı Faz 3 kapsamındadır; belge saklandı ancak metni çıkarılamadı. " +
          "UYDURMA METİN ÜRETİLMEDİ.",
      };
    }

    return {
      outcome: "TAMAM",
      text: truncate(text),
      pageCount: parsed.numpages,
      note:
        `PDF metin katmanından ${text.length} karakter okundu (${parsed.numpages} sayfa).` +
        (truncatedByPages
          ? ` UYARI: yalnızca ilk ${MAX_PDF_PAGES} sayfa okundu; kalan sayfaların metni ` +
            "çıkarılmadı ve sınıflandırma/süre tespiti bu kısmi metne dayanır."
          : ""),
    };
  } catch (err) {
    return {
      outcome: "BASARISIZ",
      note: `PDF ayrıştırılamadı: ${(err as Error).message}`,
    };
  }
}

function extractFromTxt(buffer: Buffer): TextExtractResult {
  const text = normalizeWhitespace(buffer.toString("utf8"));
  if (text.length === 0) {
    return { outcome: "BASARISIZ", note: "Metin dosyası boş." };
  }
  return {
    outcome: "TAMAM",
    text: truncate(text),
    note: `Düz metin dosyasından ${text.length} karakter okundu.`,
  };
}

/**
 * DOCX metin çıkarma (F2 · B2).
 *
 * ZIP'teki `word/document.xml` alınır; paragraflar `<w:p>` sonuyla bölünür ve
 * her paragraftaki `<w:t>…</w:t>` içerikleri birleştirilir. Biçim, üstveri ve
 * diğer bölümler YOK SAYILIR — hattın işi belgenin METNİDİR.
 *
 * Paragraf sonu `\n` ile taşınır: metnin tamamı tek satıra indirilirse süre
 * tespiti "tebliğ tarihi ... satır sonu" ipuçlarını yitirir.
 */
async function extractFromDocx(buffer: Buffer): Promise<TextExtractResult> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const entry = zip.file("word/document.xml");
    if (!entry) {
      return {
        outcome: "BASARISIZ",
        note: "DOCX arşivinde word/document.xml bulunamadı; belge bozuk olabilir.",
      };
    }
    const xml = await entry.async("string");
    const paragraphs = xml.split(/<\/w:p>/).map((chunk) => {
      const runs = [...chunk.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
      return runs.join("");
    });
    const text = normalizeWhitespace(
      paragraphs
        .map((p) => p.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
        .join("\n"),
    );
    if (text.length < MIN_MEANINGFUL_TEXT_LENGTH) {
      return {
        outcome: "BASARISIZ",
        note: "DOCX içinde okunabilir metin bulunamadı (belge yalnız görsel içeriyor olabilir).",
      };
    }
    return {
      outcome: "TAMAM",
      text: truncate(text),
      note: `DOCX metin katmanından ${text.length} karakter okundu (${paragraphs.length} paragraf).`,
    };
  } catch (err) {
    return {
      outcome: "BASARISIZ",
      note: `DOCX ayrıştırılamadı: ${(err as Error).message}`,
    };
  }
}

/**
 * UDF metin çıkarma (F2 · B2).
 *
 * `readUdf` arşivi açar; `rawText` (CDATA ham metni) kullanılır —
 * packages/udf'teki sözleşme gereği PII taraması ve indeksleme DAİMA bu alan
 * üzerinden yapılmalıdır (paragraflardan yeniden kurulan metin, kapsanmayan
 * kısmı sessizce düşürebilir).
 */
async function extractFromUdf(buffer: Buffer): Promise<TextExtractResult> {
  try {
    const doc = await readUdf(buffer);
    const text = normalizeWhitespace(doc.rawText ?? "");
    if (text.length === 0) {
      return {
        outcome: "BASARISIZ",
        note: "UDF arşivi okundu ancak içinde metin bulunamadı.",
      };
    }
    const warnings =
      doc.parseWarnings && doc.parseWarnings.length > 0
        ? ` Ayrıştırma uyarıları: ${doc.parseWarnings.join("; ")}`
        : "";
    return {
      outcome: "TAMAM",
      text: truncate(text),
      note: `UDF ham metninden ${text.length} karakter okundu (${doc.paragraphs.length} paragraf).${warnings}`,
    };
  } catch (err) {
    return {
      outcome: "BASARISIZ",
      note: `UDF ayrıştırılamadı: ${(err as Error).message}`,
    };
  }
}

type FileKind = "pdf" | "txt" | "docx" | "image" | "udf" | "unknown";

function detectKind(mimeType: string | null | undefined, fileName: string): FileKind {
  const mime = (mimeType ?? "").toLowerCase();
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();

  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("text/") || ext === "txt") return "txt";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    return "docx";
  }
  if (mime.startsWith("image/") || ext === "jpg" || ext === "jpeg" || ext === "png") return "image";
  if (ext === "udf") return "udf";
  return "unknown";
}

/** OCR çıktısındaki kırık satır sonlarını ve fazla boşlukları toparlar. */
export function normalizeWhitespace(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text: string): string {
  return text.length > MAX_EXTRACTED_TEXT_CHARS ? text.slice(0, MAX_EXTRACTED_TEXT_CHARS) : text;
}
