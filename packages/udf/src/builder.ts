/**
 * UDF üretici (builder).
 *
 * Paragraf listesinden `content.xml` üretir ve ZIP'ler.
 *
 * OFFSET BİRİMİ — bilinçli tercih:
 * Tüm `startOffset` / `length` değerleri **UTF-16 kod birimi** cinsindendir,
 * yani JavaScript'te `string.length` ile birebir aynıdır. UDF Java tabanlı bir
 * formattır ve Java `String` indeksleri de UTF-16 kod birimidir; bu yüzden iki
 * taraf birebir örtüşür. UTF-8 BAYT uzunluğu KULLANILMAZ. Örnek: "ÇĞİÖŞÜ"
 * UTF-8'de 12 bayttır ama offset hesabında 6 birimdir.
 */

import JSZip from "jszip";

import {
  EMIT_PARAGRAPH_OFFSETS,
  SWING_ALIGNMENT,
  UDF_ATTR,
  UDF_CONTENT_ENTRY,
  UDF_DEFAULT_FONT_FAMILY,
  UDF_DEFAULT_FONT_SIZE,
  UDF_DEFAULT_FORMAT_ID,
  UDF_DEFAULT_RESOLUTION,
  UDF_PARAGRAPH_SEPARATOR,
  UDF_ROOT_TAG,
} from "./spec";
import { mergeStyle } from "./style-utils";
import type {
  CreateUdfOptions,
  UdfDocument,
  UdfParagraph,
  UdfTextStyle,
} from "./types";
import { escapeXmlAttr, serializeAttributes, wrapCdata } from "./xml-utils";

/** ZIP çıktısının belirleyici (deterministik) olması için varsayılan zaman damgası. */
const DEFAULT_ENTRY_DATE = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

/** Bir paragrafın belge metni içindeki yerleşimi. */
export interface ParagraphPlacement {
  paragraph: UdfParagraph;
  /** Belge başına göre başlangıç indeksi (UTF-16 kod birimi). */
  startOffset: number;
  /**
   * Paragrafın kapladığı toplam uzunluk. Son paragraf DIŞINDA, paragrafı
   * izleyen "\n" ayırıcı da bu uzunluğa dâhildir (Swing `StyledDocument`
   * davranışı: satır sonu, kendinden önceki paragrafın elemanına aittir).
   */
  length: number;
  /** Ayırıcı hariç, saf metnin uzunluğu. */
  textLength: number;
}

/** Belgenin düz metni ve paragraf offsetleri. */
export interface DocumentLayout {
  text: string;
  placements: ParagraphPlacement[];
}

/**
 * Paragrafların düz metnini birleştirip offset/length değerlerini hesaplar.
 * Paragraflar arasına tek "\n" konur; son paragraftan sonra ayırıcı EKLENMEZ.
 */
export function computeLayout(paragraphs: UdfParagraph[]): DocumentLayout {
  const placements: ParagraphPlacement[] = [];
  const chunks: string[] = [];
  let offset = 0;

  paragraphs.forEach((paragraph, index) => {
    const text = normalizeParagraphText(paragraph.text);
    const isLast = index === paragraphs.length - 1;
    const textLength = text.length; // UTF-16 kod birimi
    const length = textLength + (isLast ? 0 : UDF_PARAGRAPH_SEPARATOR.length);
    chunks.push(text);
    if (!isLast) chunks.push(UDF_PARAGRAPH_SEPARATOR);
    placements.push({ paragraph, startOffset: offset, length, textLength });
    offset += length;
  });

  return { text: chunks.join(""), placements };
}

/**
 * Paragraf metnini normalize eder: satır sonu karakterleri paragraf sınırlarını
 * bozacağı için boşluğa çevrilir. Çok satırlı içerik, ayrı paragraflar hâlinde
 * verilmelidir.
 */
function normalizeParagraphText(text: string): string {
  return (text ?? "").replace(/\r\n?/g, "\n").replace(/\n/g, " ");
}

/** Belge varsayılanlarını doldurur. */
export function normalizeDocument(doc: Partial<UdfDocument> & { paragraphs?: UdfParagraph[] }): UdfDocument {
  return {
    metadata: {
      formatId: UDF_DEFAULT_FORMAT_ID,
      resolution: UDF_DEFAULT_RESOLUTION,
      ...(doc.metadata ?? {}),
    },
    paragraphs: doc.paragraphs ?? [],
    defaultStyle: {
      fontFamily: UDF_DEFAULT_FONT_FAMILY,
      fontSize: UDF_DEFAULT_FONT_SIZE,
      ...(doc.defaultStyle ?? {}),
    },
    // `rawText` ve `parseWarnings` BİLİNÇLİ olarak taşınmaz: builder metni paragraflardan
    // yeniden kurar; ayrıştırmadan gelen ham metni korumak, artık paragraflarla uyuşmayan
    // bir "ham metin" iddiası yaratırdı. Ayrıştırılan bir belgeyi yeniden yazacaksanız
    // önce `parseWarnings` boş mu diye bakın (kapsam eksikse yeniden yazma metin kaybeder).
  };
}

/** Biçim aralığı — offsetler belge başına göre mutlaktır. */
interface ResolvedSegment {
  startOffset: number;
  length: number;
  style: UdfTextStyle;
}

/**
 * Bir paragrafı, tüm uzunluğunu (ayırıcı dâhil) kesintisiz kaplayan biçim
 * aralıklarına böler. Örtüşen `runs` girdilerinde önce gelen kazanır.
 */
export function buildSegments(placement: ParagraphPlacement, documentDefault: UdfTextStyle): ResolvedSegment[] {
  const { paragraph, startOffset, length, textLength } = placement;
  const baseStyle = mergeStyle(documentDefault, paragraph.style);
  const segments: ResolvedSegment[] = [];

  const runs = (paragraph.runs ?? [])
    .map((run) => ({
      start: Math.max(0, Math.trunc(run.startOffset)),
      end: Math.max(0, Math.trunc(run.startOffset) + Math.trunc(run.length)),
      style: run.style,
    }))
    .filter((run) => run.end > run.start && run.start < textLength)
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const run of runs) {
    const start = Math.min(run.start, textLength);
    const end = Math.min(run.end, textLength);
    if (end <= cursor) continue; // tamamen örtüşen aralık: yok say
    const from = Math.max(start, cursor);
    if (from > cursor) {
      segments.push({ startOffset: startOffset + cursor, length: from - cursor, style: baseStyle });
    }
    segments.push({
      startOffset: startOffset + from,
      length: end - from,
      style: mergeStyle(baseStyle, run.style),
    });
    cursor = end;
  }

  // Kalan metin + paragraf ayırıcısı (varsa) taban biçimle kapatılır.
  if (cursor < length) {
    segments.push({ startOffset: startOffset + cursor, length: length - cursor, style: baseStyle });
  }

  return segments;
}

function styleAttributes(style: UdfTextStyle): Record<string, string | number | boolean | undefined> {
  return {
    [UDF_ATTR.fontFamily]: style.fontFamily,
    [UDF_ATTR.fontSize]: style.fontSize,
    [UDF_ATTR.bold]: style.bold === undefined ? undefined : style.bold,
    [UDF_ATTR.italic]: style.italic === undefined ? undefined : style.italic,
    [UDF_ATTR.underline]: style.underline === undefined ? undefined : style.underline,
    [UDF_ATTR.strikethrough]: style.strikethrough === undefined ? undefined : style.strikethrough,
    [UDF_ATTR.foreground]: style.color,
  };
}

function paragraphAttributes(placement: ParagraphPlacement): Record<string, string | number | boolean | undefined> {
  const layout = placement.paragraph.layout ?? {};
  const attrs: Record<string, string | number | boolean | undefined> = {
    [UDF_ATTR.alignment]: layout.alignment ? SWING_ALIGNMENT[layout.alignment] : undefined,
    [UDF_ATTR.leftIndent]: layout.leftIndent,
    [UDF_ATTR.rightIndent]: layout.rightIndent,
    [UDF_ATTR.firstLineIndent]: layout.firstLineIndent,
    [UDF_ATTR.spaceAbove]: layout.spaceAbove,
    [UDF_ATTR.spaceBelow]: layout.spaceBelow,
    [UDF_ATTR.lineSpacing]: layout.lineSpacing,
  };
  if (EMIT_PARAGRAPH_OFFSETS) {
    // TEYİT GEREKİR: `<paragraph>` üzerinde offset/length öznitelikleri gerçek
    // UYAP dosyalarında görülmeyebilir. Ayrıştırmayı tamamen belirleyici kılmak
    // için yazıyoruz; UYAP editörü sorun çıkarırsa spec.ts içindeki
    // EMIT_PARAGRAPH_OFFSETS false yapılabilir.
    attrs[UDF_ATTR.startOffset] = placement.startOffset;
    attrs[UDF_ATTR.length] = placement.length;
  }
  return attrs;
}

/** `content.xml` metnini üretir. */
export function buildContentXml(input: UdfDocument): string {
  const doc = normalizeDocument(input);
  const layout = computeLayout(doc.paragraphs);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<${UDF_ROOT_TAG} ${UDF_ATTR.formatId}="${escapeXmlAttr(doc.metadata.formatId ?? UDF_DEFAULT_FORMAT_ID)}">`);

  // Belgenin tüm düz metni tek CDATA bloğunda taşınır. Kesin bilgi.
  lines.push(`  <content>${wrapCdata(layout.text)}</content>`);

  if (doc.metadata.pageFormat) {
    // TEYİT GEREKİR: `<properties><pageFormat .../></properties>` öznitelik
    // adları ve birimleri gerçek dosyayla doğrulanmalıdır.
    const pf = doc.metadata.pageFormat;
    lines.push("  <properties>");
    lines.push(
      `    <pageFormat${serializeAttributes({
        mediaSizeName: pf.mediaSizeName,
        leftMargin: pf.leftMargin,
        rightMargin: pf.rightMargin,
        topMargin: pf.topMargin,
        bottomMargin: pf.bottomMargin,
        paperOrientation: pf.paperOrientation,
        headerFOffset: pf.headerFOffset,
        footerFOffset: pf.footerFOffset,
      })} />`,
    );
    lines.push("  </properties>");
  }

  lines.push(`  <elements${serializeAttributes({ [UDF_ATTR.resolution]: doc.metadata.resolution })}>`);
  for (const placement of layout.placements) {
    const segments = buildSegments(placement, doc.defaultStyle);
    const openTag = `    <paragraph${serializeAttributes(paragraphAttributes(placement))}`;
    if (segments.length === 0) {
      lines.push(`${openTag} />`);
      continue;
    }
    lines.push(`${openTag}>`);
    for (const segment of segments) {
      lines.push(
        `      <content${serializeAttributes({
          [UDF_ATTR.startOffset]: segment.startOffset,
          [UDF_ATTR.length]: segment.length,
          ...styleAttributes(segment.style),
        })} />`,
      );
    }
    lines.push("    </paragraph>");
  }
  lines.push("  </elements>");

  // Varsayılan stil tanımı. TEYİT GEREKİR: `<styles>` düğümünün gerçek şeması.
  lines.push("  <styles>");
  lines.push(
    `    <style${serializeAttributes({
      name: "default",
      description: "Varsayılan",
      ...styleAttributes(doc.defaultStyle),
    })} />`,
  );
  lines.push("  </styles>");

  lines.push(`</${UDF_ROOT_TAG}>`);
  return lines.join("\n");
}

/**
 * UdfDocument'ten UDF (ZIP) baytlarını üretir.
 *
 * @example
 * const bytes = await createUdf({
 *   metadata: {},
 *   defaultStyle: {},
 *   paragraphs: [{ text: "Sayın Hâkimliğe", layout: { alignment: "center" } }],
 * });
 */
export async function createUdf(doc: UdfDocument, options: CreateUdfOptions = {}): Promise<Uint8Array> {
  const xml = buildContentXml(doc);
  const zip = new JSZip();
  const date = options.entryDate ?? doc.metadata.createdAt ?? DEFAULT_ENTRY_DATE;

  zip.file(UDF_CONTENT_ENTRY, xml, { date });
  for (const extra of options.extraFiles ?? []) {
    // DÜZELTİLDİ (kod denetimi, bulgu 2): jszip'in `file()` imzası jenerik bir indexed
    // access'tir (`JSZip.InputByType[T]`); `Uint8Array | string` BİRLEŞİMİ tek bir anahtara
    // çözülemeyip TS2769 "No overload matches this call" verir. Birleşim çağrı yerinde ayrılır.
    if (typeof extra.content === "string") {
      zip.file(extra.path, extra.content, { date });
    } else {
      zip.file(extra.path, extra.content, { date });
    }
  }

  return zip.generateAsync({
    type: "uint8array",
    compression: options.compress === false ? "STORE" : "DEFLATE",
  });
}
