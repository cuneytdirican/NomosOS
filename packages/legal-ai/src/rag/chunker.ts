/**
 * RAG belge parçalama (chunking).
 *
 * Tasarım ilkeleri:
 *  1. PARAGRAF SINIRLARINI KORU — hukuki metinde bir paragrafın ortasından
 *     kesmek, cümlenin anlamını (ve dolayısıyla alıntının doğruluğunu) bozar.
 *     Parçalar paragraf sınırında başlar ve biter; yalnızca tek bir paragraf
 *     maksimum boyutu aşıyorsa cümle sınırından bölünür.
 *  2. ÖRTÜŞME (overlap) — bir sonraki parça, öncekinin son paragraf(lar)ını
 *     taşır; böylece parça sınırına denk gelen bir ifade retrieval'da kaybolmaz.
 *  3. KAYNAK KÜNYESİ — her parçaya belge adı ve sayfa/paragraf aralığı
 *     iliştirilir. Cevapta "Cevap Dilekçesi s.3 ¶2-4" diye kaynak gösterilebilmesi
 *     bu künyeye bağlıdır; künyesiz parça cevapta kullanılamaz.
 */

export interface ChunkSourceMeta {
  documentId: string;
  documentTitle: string;
  documentClass?: string;
}

/** Sayfa bilinen belgeler için girdi birimi. */
export interface PagedSegment {
  page: number;
  text: string;
}

export interface ChunkOptions {
  /** Bir parçanın hedef üst sınırı (karakter). Varsayılan 1200. */
  maxChars?: number;
  /** Örtüşme bütçesi (karakter). Varsayılan 200. */
  overlapChars?: number;
  /**
   * Son parça bundan kısaysa bir öncekiyle birleştirilir (yetim parça önleme).
   * Varsayılan 150.
   */
  minChars?: number;
}

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  /** Belge metnindeki karakter aralığı (örtüşme dahil). */
  charStart: number;
  charEnd: number;
  /** 1 tabanlı paragraf aralığı. */
  paragraphFrom: number;
  paragraphTo: number;
  pageFrom?: number;
  pageTo?: number;
  /** Cevapta gösterilecek kaynak künyesi: "Cevap Dilekçesi — s.3 ¶2-4". */
  citationLabel: string;
  source: ChunkSourceMeta;
  /** Bu parçanın başındaki, bir önceki parçadan taşınan karakter sayısı. */
  overlapChars: number;
}

interface Paragraph {
  index: number; // 1 tabanlı
  text: string;
  start: number;
  end: number;
  page?: number;
}

const DEFAULTS = { maxChars: 1200, overlapChars: 200, minChars: 150 };

/** Metni paragraflara böler; boş satır(lar) ayraçtır, konumlar korunur. */
export function splitParagraphs(text: string, offset = 0, page?: number): Paragraph[] {
  const out: Paragraph[] = [];
  const re = /\n[ \t]*\n+/g;
  let cursor = 0;
  let m: RegExpExecArray | null;

  const push = (start: number, end: number): void => {
    const raw = text.slice(start, end);
    const trimmedStart = start + (raw.length - raw.trimStart().length);
    const trimmed = raw.trim();
    if (!trimmed) return;
    out.push({
      index: out.length + 1,
      text: trimmed,
      start: offset + trimmedStart,
      end: offset + trimmedStart + trimmed.length,
      page,
    });
  };

  while ((m = re.exec(text)) !== null) {
    push(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  push(cursor, text.length);

  return out;
}

/** Çok uzun tek paragrafı cümle sınırından böler; cümle de uzunsa sert keser. */
function splitLongParagraph(p: Paragraph, maxChars: number): Paragraph[] {
  if (p.text.length <= maxChars) return [p];

  const pieces: Paragraph[] = [];
  // Cümle sonu: nokta/soru/ünlem + boşluk. Türkçe kısaltmalar için kusursuz değil,
  // ancak parça sınırı olarak yeterlidir.
  const sentenceEnd = /(?<=[.!?…])\s+/g;
  const parts: Array<{ text: string; start: number }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  sentenceEnd.lastIndex = 0;
  while ((m = sentenceEnd.exec(p.text)) !== null) {
    parts.push({ text: p.text.slice(last, m.index), start: last });
    last = m.index + m[0].length;
  }
  parts.push({ text: p.text.slice(last), start: last });

  let buffer = "";
  let bufferStart = 0;
  const flush = (): void => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    pieces.push({
      index: p.index,
      text: trimmed,
      start: p.start + bufferStart,
      end: p.start + bufferStart + trimmed.length,
      page: p.page,
    });
    buffer = "";
  };

  for (const part of parts) {
    if (!part.text) continue;
    if (buffer.length === 0) {
      buffer = part.text;
      bufferStart = part.start;
    } else if (buffer.length + 1 + part.text.length <= maxChars) {
      buffer = `${buffer} ${part.text}`;
    } else {
      flush();
      buffer = part.text;
      bufferStart = part.start;
    }
    // Tek cümle bile sınırı aşıyorsa sert kes.
    while (buffer.length > maxChars) {
      const head = buffer.slice(0, maxChars);
      pieces.push({
        index: p.index,
        text: head,
        start: p.start + bufferStart,
        end: p.start + bufferStart + head.length,
        page: p.page,
      });
      buffer = buffer.slice(maxChars);
      bufferStart += maxChars;
    }
  }
  flush();

  return pieces.length > 0 ? pieces : [p];
}

function buildCitationLabel(
  source: ChunkSourceMeta,
  pageFrom: number | undefined,
  pageTo: number | undefined,
  paragraphFrom: number,
  paragraphTo: number,
): string {
  const parts = [source.documentTitle];
  if (pageFrom !== undefined) {
    parts.push(pageTo !== undefined && pageTo !== pageFrom ? `s.${pageFrom}-${pageTo}` : `s.${pageFrom}`);
  }
  parts.push(paragraphTo !== paragraphFrom ? `¶${paragraphFrom}-${paragraphTo}` : `¶${paragraphFrom}`);
  return parts.join(" — ");
}

function assemble(
  paragraphs: readonly Paragraph[],
  source: ChunkSourceMeta,
  options: Required<ChunkOptions>,
): DocumentChunk[] {
  const { maxChars, overlapChars, minChars } = options;
  const chunks: DocumentChunk[] = [];
  if (paragraphs.length === 0) return chunks;

  let current: Paragraph[] = [];
  let carried: Paragraph[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const content = current.map((p) => p.text).join("\n\n");
    const pages = current.map((p) => p.page).filter((p): p is number => typeof p === "number");
    const carriedChars = carried.length
      ? carried.map((p) => p.text).join("\n\n").length + (current.length > carried.length ? 2 : 0)
      : 0;

    const paragraphFrom = current[0].index;
    const paragraphTo = current[current.length - 1].index;
    const pageFrom = pages.length ? Math.min(...pages) : undefined;
    const pageTo = pages.length ? Math.max(...pages) : undefined;

    chunks.push({
      chunkIndex: chunks.length,
      content,
      charStart: current[0].start,
      charEnd: current[current.length - 1].end,
      paragraphFrom,
      paragraphTo,
      pageFrom,
      pageTo,
      citationLabel: buildCitationLabel(source, pageFrom, pageTo, paragraphFrom, paragraphTo),
      source,
      overlapChars: carriedChars,
    });
  };

  /** Parça kapandıktan sonra bir sonrakine taşınacak son paragraf(lar)ı seçer. */
  const pickOverlap = (closed: readonly Paragraph[]): Paragraph[] => {
    if (overlapChars <= 0 || closed.length <= 1) return [];
    const picked: Paragraph[] = [];
    let total = 0;
    for (let i = closed.length - 1; i >= 0; i--) {
      const len = closed[i].text.length;
      if (total + len > overlapChars) break;
      picked.unshift(closed[i]);
      total += len;
      // Tüm parçayı taşıyıp sonsuz döngüye girmeyelim.
      if (picked.length >= closed.length - 1) break;
    }
    return picked;
  };

  const lengthOf = (list: readonly Paragraph[]): number =>
    list.reduce((sum, p, i) => sum + p.text.length + (i > 0 ? 2 : 0), 0);

  for (const paragraph of paragraphs) {
    const next = [...current, paragraph];
    if (current.length > 0 && lengthOf(next) > maxChars) {
      flush();
      carried = pickOverlap(current);
      current = [...carried, paragraph];
    } else {
      current = next;
    }
  }

  // Son parça çok kısaysa ve önceki parça varsa, yetim bırakmak yerine birleştir.
  if (current.length > 0) {
    const tailLength = lengthOf(current.filter((p) => !carried.includes(p)));
    if (chunks.length > 0 && tailLength > 0 && tailLength < minChars) {
      const prev = chunks[chunks.length - 1];
      const merged = current.filter((p) => !carried.includes(p));
      const addition = merged.map((p) => p.text).join("\n\n");
      prev.content = `${prev.content}\n\n${addition}`;
      prev.charEnd = merged[merged.length - 1].end;
      prev.paragraphTo = merged[merged.length - 1].index;
      const mergedPages = merged.map((p) => p.page).filter((p): p is number => typeof p === "number");
      if (mergedPages.length) {
        prev.pageTo = Math.max(prev.pageTo ?? mergedPages[0], ...mergedPages);
        prev.pageFrom = Math.min(prev.pageFrom ?? mergedPages[0], ...mergedPages);
      }
      prev.citationLabel = buildCitationLabel(
        source,
        prev.pageFrom,
        prev.pageTo,
        prev.paragraphFrom,
        prev.paragraphTo,
      );
    } else {
      flush();
    }
  }

  return chunks;
}

/** Düz metin belgeyi parçalar. */
export function chunkDocument(
  text: string,
  source: ChunkSourceMeta,
  options: ChunkOptions = {},
): DocumentChunk[] {
  const opts: Required<ChunkOptions> = { ...DEFAULTS, ...options };
  if (opts.maxChars <= 0) {
    throw new Error("Parçalama yapılamadı: maxChars pozitif olmalıdır.");
  }
  if (opts.overlapChars >= opts.maxChars) {
    throw new Error("Parçalama yapılamadı: örtüşme, parça boyutundan küçük olmalıdır.");
  }

  const paragraphs = splitParagraphs(text).flatMap((p) => splitLongParagraph(p, opts.maxChars));
  // splitLongParagraph aynı paragraf numarasını koruyabilir; sırayı yeniden numaralandır.
  const renumbered = paragraphs.map((p, i) => ({ ...p, index: i + 1 }));
  return assemble(renumbered, source, opts);
}

/** Sayfa bilgisi olan (OCR'lı) belgeyi parçalar; künyeye sayfa numarası girer. */
export function chunkPagedDocument(
  segments: readonly PagedSegment[],
  source: ChunkSourceMeta,
  options: ChunkOptions = {},
): DocumentChunk[] {
  const opts: Required<ChunkOptions> = { ...DEFAULTS, ...options };
  if (opts.overlapChars >= opts.maxChars) {
    throw new Error("Parçalama yapılamadı: örtüşme, parça boyutundan küçük olmalıdır.");
  }

  const paragraphs: Paragraph[] = [];
  let offset = 0;
  for (const segment of segments) {
    const pageParagraphs = splitParagraphs(segment.text, offset, segment.page).flatMap((p) =>
      splitLongParagraph(p, opts.maxChars),
    );
    paragraphs.push(...pageParagraphs);
    offset += segment.text.length + 2;
  }
  const renumbered = paragraphs.map((p, i) => ({ ...p, index: i + 1 }));
  return assemble(renumbered, source, opts);
}
