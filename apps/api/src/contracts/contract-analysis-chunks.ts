/**
 * SÖZLEŞME ANALİZİ PARÇALAMASI — sayfa bazlı map-reduce girdisi.
 *
 * NEDEN BURADA: analiz koşusu artık sözleşmeyi TEK prompta tıkmıyor. Metin
 * önce SANAL SAYFALARA (≈3.000 karakter, paragraf sınırında) sonra
 * legal-ai chunker'ı ile PARÇALARA bölünür; her parça için AYRI AI çağrısı
 * yapılır (bkz. contract-analysis.service.ts). Bu dosya O bölmenin SAF
 * hesabıdır — DB yok, AI yok; kredi kapısı da buradan ölçer.
 *
 * SAYFA KAVRAMI: ContractVersion.contentText düz metindir; fiziksel sayfa
 * numarası yoktur. "Sayfa" burada KONUMSAL bir ölçüdür (≈3.000 karakter,
 * paragraf sınırına yuvarlanır): şerh "s.42" dediğinde kullanıcının metnin
 * o bölgesini bulması için yeterli, birebaskı sayfa numarası değildir.
 *
 * AYNI HESAP ÜÇ YERDE ÇALIŞIR (ayrışma riski tek kaynakla kapanır):
 *   · analiz koşusu  — buildAnalysisChunks ile parçaları üretir,
 *   · kredi kapısı   — estimateAnalysisUnits ile parça sayısını fiyatlar,
 *   · sürüm farkı    — splitIntoPages ile sayfa penceresinde karşılaştırır.
 */

import {
  chunkPagedDocument,
  splitParagraphs,
  type ChunkSourceMeta,
  type DocumentChunk,
  type PagedSegment,
} from "@nomosos/legal-ai";

/** Sanal sayfa hedef boyutu (karakter). */
export const CONTRACT_PAGE_CHARS = 3_000;

/** Bir analiz parçasının hedef üst sınırı (karakter) — tek AI çağrısının gövdesi. */
export const ANALYSIS_CHUNK_CHARS = 24_000;

/** Parçalar arası örtüşme bütçesi (karakter) — parça sınırındaki maddeler kaybolmasın. */
export const ANALYSIS_CHUNK_OVERLAP_CHARS = 600;

/** Son parça bundan kısaysa bir öncekiyle birleştirilir (yetim parça önleme). */
export const ANALYSIS_CHUNK_MIN_CHARS = 800;

/**
 * Tek bir analiz koşusunda izin verilen azami parça sayısı.
 * Bu bir TAVAN DEĞİL, EMNİYET VALFİDİR: buna ulaşan sözleşme (~400+ sayfa)
 * tek istekte dakikalar sürer ve krediyi kilitler — avukat metni bölerek
 * analiz etmelidir. Sessizce kırpma YOKTUR: reddedilir ve gerekçe döner.
 */
export const MAX_ANALYSIS_CHUNKS = 400;

/**
 * Metni sanal sayfalara böler — paragraf sınırları korunur.
 *
 * Tek bir paragraf sayfa boyutunu aşıyorsa CÜMLE sınırı aranmadan sert
 * kesilir: sayfa KONUM ölçüsüdür, anlam taşıyıcısı değildir (anlam bütünlüğü
 * chunker'ın işidir; o kendi paragraf/cümle sınırlarını korur).
 */
export function splitIntoPages(text: string, pageChars: number = CONTRACT_PAGE_CHARS): PagedSegment[] {
  if (pageChars <= 0) throw new Error("Sayfa boyutu pozitif olmalıdır.");
  const trimmed = text.trim();
  if (!trimmed) return [];

  const pages: PagedSegment[] = [];
  let current = "";

  const flush = (): void => {
    const body = current.trim();
    if (body) pages.push({ page: pages.length + 1, text: body });
    current = "";
  };

  for (const paragraph of splitParagraphs(trimmed)) {
    let remaining = paragraph.text;
    while (remaining.length > pageChars) {
      current += (current ? "\n\n" : "") + remaining.slice(0, pageChars);
      flush();
      remaining = remaining.slice(pageChars);
    }
    if (!remaining) continue;
    if (current && current.length + remaining.length + 2 > pageChars) flush();
    current += (current ? "\n\n" : "") + remaining;
  }
  flush();
  return pages;
}

/** Sözleşme metnini analiz parçalarına böler — her parça sayfa künyesi taşır. */
export function buildAnalysisChunks(
  text: string,
  source: ChunkSourceMeta,
  options: { maxChars?: number; overlapChars?: number; minChars?: number } = {},
): DocumentChunk[] {
  return chunkPagedDocument(splitIntoPages(text), source, {
    maxChars: options.maxChars ?? ANALYSIS_CHUNK_CHARS,
    overlapChars: options.overlapChars ?? ANALYSIS_CHUNK_OVERLAP_CHARS,
    minChars: options.minChars ?? ANALYSIS_CHUNK_MIN_CHARS,
  });
}

export interface AnalysisUnitEstimate {
  /** Koşunun yapacağı AI çağrı sayısı (= parça sayısı). */
  chunkCount: number;
  /** Sanal sayfa sayısı (≈ metin / 3.000 karakter). */
  pageCount: number;
  /** Metnin toplam karakter sayısı. */
  chars: number;
  /** En uzun parçanın karakter boyutu — kredi kapısının birim ölçüsü. */
  chunkChars: number;
}

/**
 * Parça sayısını ÖLÇER (AI çağrısı yok) — kredi kapısı ve tahmin ucunun
 * tek kaynağı. Bölmenin kendisiyle AYNI hesabı kullanır ki kapının
 * rezerve ettiği parça sayısı koşunun gerçek parça sayısıyla tutarsın.
 */
export function estimateAnalysisUnits(text: string): AnalysisUnitEstimate {
  const trimmed = text.trim();
  if (!trimmed) return { chunkCount: 0, pageCount: 0, chars: 0, chunkChars: 0 };
  const pages = splitIntoPages(trimmed);
  const chunks = buildAnalysisChunks(trimmed, {
    documentId: "estimate",
    documentTitle: "tahmin",
  });
  const chunkChars = chunks.reduce((max, c) => Math.max(max, c.content.length), 0);
  return { chunkCount: chunks.length, pageCount: pages.length, chars: trimmed.length, chunkChars };
}
