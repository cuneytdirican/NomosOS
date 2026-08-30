/**
 * Adım 1 — METİN ÇIKARMA.
 *
 * KURAL: METİN UYDURULMAZ. Bir biçimden metin çıkarılamıyorsa sonuç açıkça
 * BASARISIZ/GEREKSIZ işaretlenir ve nedeni Türkçe yazılır. Sonraki adımlar
 * (sınıflandırma, süre tespiti) metin yoksa ATLANIR — "boş metinden sınıf
 * uydurmak" halüsinasyonun en ucuz yoludur.
 *
 * Faz 2 kapsamı:
 *   - PDF  → pdf-parse (gömülü metin katmanı). Taranmış PDF'te metin katmanı
 *            yoktur; bu durumda gerçek OCR gerekir → BASARISIZ + açık not.
 *   - TXT  → doğrudan UTF-8.
 *   - DOCX → Faz 3 (mammoth/docx ayrıştırıcısı) → GEREKSIZ + açık not.
 *   - Görsel (JPEG/PNG) → gerçek OCR Faz 3 (tesseract) → BASARISIZ + açık not.
 *   - UDF  → içindeki content.xml Faz 3'te okunacak → GEREKSIZ + açık not.
 */

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
      return {
        outcome: "GEREKSIZ",
        note:
          "DOCX metin çıkarma Faz 3 kapsamındadır. Belge saklandı ancak metni okunmadı; " +
          "sınıflandırma ve süre tespiti bu belge için çalıştırılmadı. " +
          "Metni PDF veya düz metin olarak yüklerseniz hat tam çalışır.",
      };
    case "image":
      return {
        outcome: "BASARISIZ",
        note:
          "Görsel belgelerde OCR Faz 3 kapsamındadır (henüz kurulu değil). " +
          "Belge saklandı; metni okunamadığı için sınıflandırma ve süre tespiti yapılmadı. " +
          "Metin katmanı olan bir PDF yüklerseniz hat tam çalışır.",
      };
    case "udf":
      return {
        outcome: "GEREKSIZ",
        note:
          "UDF içerik ayrıştırması Faz 3 kapsamındadır. Belge saklandı ancak metni okunmadı.",
      };
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
