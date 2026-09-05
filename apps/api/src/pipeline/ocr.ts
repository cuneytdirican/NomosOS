/**
 * OCR — taranmış PDF ve görsel belgeler (Faz 1, avukat çekirdeği).
 *
 * KARAR: tesseract.js SUNUCU İÇİ (veri büro dışına çıkmaz — KVKK; ek servis
 * yok). Dil verisi (`tur`, `eng`) ilk kullanımda `OCR_LANG_PATH`'ten (yerel
 * dizin, çevrimdışı kurulum) ya da tesseract.js'in varsayılan CDN'inden çekilir
 * ve `OCR_CACHE_PATH`'e önbelleklenir.
 *
 * Taranmış PDF için sayfa RENDER edilmez (canvas/pdfjs yerel bağımlılık ister,
 * alpine imajında kırılgandır). Tarayıcıların ürettiği PDF'ler sayfa başına bir
 * JPEG (`/DCTDecode`) taşır; bu akışlar doğrudan PDF baytlarından ayıklanıp
 * OCR'a verilir. JPEG taşımayan (CCITT/JBIG2/JPX) taramalar için dürüstçe
 * BASARISIZ + açık not döner — METİN UYDURULMAZ.
 *
 * Sınırlar: `OCR_MAX_PAGES` (varsayılan 30) sayfa; `OCR_TIMEOUT_MS` sayfa başına.
 * Kapatma: `OCR_ENABLED=false`.
 */

import { Logger } from "@nestjs/common";
import { observeOcr } from "../metrics/metrics.registry";

export const OCR_MAX_PAGES = Number.parseInt(process.env.OCR_MAX_PAGES ?? "", 10) || 30;
export const OCR_PAGE_TIMEOUT_MS = Number.parseInt(process.env.OCR_TIMEOUT_MS ?? "", 10) || 120_000;
/** Bir sayfa görüntüsü bundan küçükse OCR'a değmez (boş/bozuk akış). */
const MIN_IMAGE_BYTES = 2_048;

const logger = new Logger("Ocr");

export function ocrEnabled(): boolean {
  return (process.env.OCR_ENABLED ?? "true").toLowerCase() !== "false";
}

export function ocrLanguages(): string {
  return process.env.OCR_LANGS?.trim() || "tur+eng";
}

/**
 * PDF baytlarından gömülü JPEG akışlarını (`/Filter /DCTDecode`) sırayla
 * ayıklar. Tarayıcı çıktısı PDF'lerde her sayfa tek bir JPEG XObject'tir.
 * Sayfa sırası, akışların dosyadaki sırasıyla alınır (tarayıcılar sıralı yazar).
 */
export function extractJpegStreamsFromPdf(pdf: Buffer, maxImages = OCR_MAX_PAGES): Buffer[] {
  const out: Buffer[] = [];
  const text = pdf.toString("latin1");
  let cursor = 0;
  while (out.length < maxImages) {
    const objStart = text.indexOf("/DCTDecode", cursor);
    if (objStart < 0) break;
    const streamKw = text.indexOf("stream", objStart);
    if (streamKw < 0) break;
    // "stream" anahtar sözcüğünden sonra CRLF ya da LF gelir.
    let dataStart = streamKw + "stream".length;
    if (text[dataStart] === "\r") dataStart += 1;
    if (text[dataStart] === "\n") dataStart += 1;
    const end = text.indexOf("endstream", dataStart);
    if (end < 0) break;
    // JPEG SOI (FF D8) ile başlamalı; /Length'e güvenilmez (dolaylı nesne olabilir).
    let dataEnd = end;
    while (dataEnd > dataStart && (text[dataEnd - 1] === "\n" || text[dataEnd - 1] === "\r")) dataEnd -= 1;
    const slice = pdf.subarray(dataStart, dataEnd);
    if (slice.length >= MIN_IMAGE_BYTES && slice[0] === 0xff && slice[1] === 0xd8) out.push(Buffer.from(slice));
    cursor = end + "endstream".length;
  }
  return out;
}

export interface OcrPageResult {
  page: number;
  text: string;
  confidence: number;
}

interface TesseractWorkerLike {
  recognize: (image: Buffer) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
}

let workerPromise: Promise<TesseractWorkerLike> | null = null;

/** Tek paylaşımlı worker — her belge için yeniden dil yüklemek pahalıdır. */
async function getWorker(): Promise<TesseractWorkerLike> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = (await import("tesseract.js")) as unknown as {
        createWorker: (langs: string, oem?: number, options?: Record<string, unknown>) => Promise<TesseractWorkerLike>;
      };
      const options: Record<string, unknown> = {
        cachePath: process.env.OCR_CACHE_PATH || "/tmp/nomosos-ocr",
        // Tesseract.js 5: 'logger' verilmezse sessizdir. Hata durumunda worker'ı sıfırlarız.
        errorHandler: (err: unknown) => logger.warn(`OCR worker hatası: ${(err as Error)?.message ?? String(err)}`),
      };
      if (process.env.OCR_LANG_PATH) {
        options.langPath = process.env.OCR_LANG_PATH;
        options.gzip = process.env.OCR_LANG_GZIP !== "false";
      }
      return mod.createWorker(ocrLanguages(), 1, options);
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Tek görüntüyü (JPEG/PNG) tanır; zaman aşımında hata fırlatır. */
export async function ocrImage(image: Buffer, page = 1): Promise<OcrPageResult> {
  const worker = await getWorker();
  const startedAt = Date.now();
  const result = await Promise.race([
    worker.recognize(image),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`OCR zaman aşımı (${Math.round(OCR_PAGE_TIMEOUT_MS / 1000)} sn, sayfa ${page})`)), OCR_PAGE_TIMEOUT_MS),
    ),
  ]);
  observeOcr(Date.now() - startedAt);
  return { page, text: result.data.text ?? "", confidence: Math.round(result.data.confidence ?? 0) };
}

/** Birden çok sayfa görüntüsünü sırayla tanır (paylaşımlı worker; paralel değil). */
export async function ocrImages(images: Buffer[]): Promise<OcrPageResult[]> {
  const pages: OcrPageResult[] = [];
  for (let i = 0; i < images.length; i++) {
    pages.push(await ocrImage(images[i], i + 1));
  }
  return pages;
}

/** Testler ve kapatma için: worker'ı serbest bırakır. */
export async function shutdownOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) {
    try {
      await (await p).terminate();
    } catch {
      /* kapanışta sessiz */
    }
  }
}

/** Testler için: worker fabrikasını değiştirmeye izin verir. */
export function __setOcrWorkerForTests(worker: TesseractWorkerLike | null): void {
  workerPromise = worker ? Promise.resolve(worker) : null;
}
