/**
 * UDF ayrıştırıcı (parser).
 *
 * ZIP'i açar, `content.xml` içindeki CDATA düz metnini ve `<elements>` altındaki
 * offset/length tabanlı paragraf yapısını `UdfDocument`'e çevirir.
 *
 * XML için harici bağımlılık kullanılmaz: UDF'in yapısı çok dar olduğundan
 * hedefli bir tag tarayıcı yeterli ve daha dayanıklıdır (DOMParser Node'da
 * bulunmaz). Ayrıştırma büyük/küçük harf duyarsızdır ve bilinmeyen
 * öznitelikleri yok sayar; bu sayede farklı UDF üreticilerine karşı toleranslı
 * kalır.
 *
 * OFFSET BİRİMİ: builder ile aynı — UTF-16 kod birimi (`string.length`).
 */

import JSZip from "jszip";

import {
  SWING_ALIGNMENT_REVERSE,
  UDF_ATTR,
  UDF_CONTENT_ENTRY,
  UDF_DEFAULT_FONT_FAMILY,
  UDF_DEFAULT_FONT_SIZE,
  UDF_DEFAULT_FORMAT_ID,
  UDF_DEFAULT_RESOLUTION,
  UDF_PARAGRAPH_SEPARATOR,
  UDF_ROOT_TAG,
} from "./spec";
import { isEmptyStyle, styleDiff, styleEquals } from "./style-utils";
import type {
  UdfAlignment,
  UdfDocument,
  UdfInput,
  UdfPageFormat,
  UdfParagraph,
  UdfParagraphLayout,
  UdfStyleRun,
  UdfTextStyle,
} from "./types";
import {
  type XmlAttributes,
  extractElementBody,
  getAttr,
  getBoolAttr,
  getNumberAttr,
  parseAttributes,
  readTextBody,
} from "./xml-utils";

/** UDF ayrıştırma hatası. */
export class UdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UdfParseError";
  }
}

/** UDF (ZIP) baytlarını okur ve belge modeline çevirir. */
export async function readUdf(input: UdfInput): Promise<UdfDocument> {
  const xml = await readContentXml(input);
  return parseContentXml(xml);
}

/** UDF arşivinden yalnızca `content.xml` metnini çıkarır. */
export async function readContentXml(input: UdfInput): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch (error) {
    throw new UdfParseError(
      `UDF dosyası açılamadı: geçerli bir ZIP arşivi değil. (${(error as Error).message})`,
    );
  }

  const entry =
    zip.file(UDF_CONTENT_ENTRY) ??
    findEntryCaseInsensitive(zip, UDF_CONTENT_ENTRY) ??
    findFirstXmlEntry(zip);

  if (!entry) {
    throw new UdfParseError("UDF arşivinde content.xml bulunamadı.");
  }
  return entry.async("string");
}

function findEntryCaseInsensitive(zip: JSZip, name: string): JSZip.JSZipObject | null {
  const target = name.toLowerCase();
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    if (normalized === target || normalized.endsWith(`/${target}`)) return file;
  }
  return null;
}

function findFirstXmlEntry(zip: JSZip): JSZip.JSZipObject | null {
  for (const [path, file] of Object.entries(zip.files)) {
    if (!file.dir && path.toLowerCase().endsWith(".xml")) return file;
  }
  return null;
}

/** Ham `content.xml` metnini belge modeline çevirir. */
export function parseContentXml(xml: string): UdfDocument {
  if (!xml || xml.indexOf(`<${UDF_ROOT_TAG}`) === -1) {
    throw new UdfParseError(`content.xml içinde <${UDF_ROOT_TAG}> kök düğümü bulunamadı.`);
  }

  const rootAttrs = readRootAttributes(xml);
  const text = readDocumentText(xml);
  const elements = extractElementBody(xml, "elements");
  const defaultStyle = readDefaultStyle(xml);
  const pageFormat = readPageFormat(xml);

  const parseWarnings: string[] = [];
  let paragraphs: UdfParagraph[];

  if (elements) {
    const parsed = parseParagraphs(elements.body, text, defaultStyle);
    paragraphs = parsed.paragraphs;

    // KVKK/veri bütünlüğü kapısı (denetim bulgusu 6): paragraf yapısı ham metnin
    // TAMAMINI kapsamıyorsa sessiz kalınmaz. Kapsanmayan metin (ör. yabancı bir
    // üreticinin eksik <elements> bloğu) düz metinden düşerdi; PII taraması da o
    // kısmı hiç görmezdi. Ham metin `rawText` ile korunur, durum uyarıya yazılır.
    if (parsed.skippedNodes > 0) {
      parseWarnings.push(
        `${parsed.skippedNodes} paragraf düğümünün sınırları (offset/length) çözülemedi ve atlandı; ` +
          "belgenin biçim yapısı eksik okunmuş olabilir.",
      );
    }
    if (text.length > 0 && parsed.coveredLength < text.length) {
      parseWarnings.push(
        `Paragraf yapısı ham metnin tamamını kapsamıyor (${parsed.coveredLength}/${text.length} ` +
          "kod birimi). Arama, indeksleme ve KVKK PII taraması için `rawText` alanı kullanılmalıdır.",
      );
    }
  } else {
    paragraphs = fallbackParagraphs(text);
    parseWarnings.push(
      "content.xml içinde <elements> bloğu bulunamadı; paragraflar ham metnin satır sonlarından türetildi.",
    );
  }

  const metadata: UdfDocument["metadata"] = {
    formatId: getAttr(rootAttrs, UDF_ATTR.formatId, "formatid", "version") ?? UDF_DEFAULT_FORMAT_ID,
    resolution: elements
      ? getNumberAttr(elements.attrs, UDF_ATTR.resolution) ?? UDF_DEFAULT_RESOLUTION
      : UDF_DEFAULT_RESOLUTION,
  };
  if (pageFormat) metadata.pageFormat = pageFormat;

  return {
    metadata,
    defaultStyle,
    // `<elements>` var ama hiç paragraf yoksa ve metin de boş değilse, metni
    // satırlara bölerek yine de kullanılabilir bir yapı döndürürüz.
    paragraphs: paragraphs.length === 0 && text.length > 0 ? fallbackParagraphs(text) : paragraphs,
    // Ham CDATA metni HER ZAMAN korunur: PII taraması ve indeksleme bunun üzerinden yapılır.
    rawText: text,
    parseWarnings,
  };
}

function readRootAttributes(xml: string): XmlAttributes {
  const re = new RegExp(`<${UDF_ROOT_TAG}((?:[^>"']|"[^"]*"|'[^']*')*)>`, "i");
  const match = re.exec(xml);
  return parseAttributes(match ? match[1] ?? "" : "");
}

/**
 * Belgenin düz metnini okur. Kökteki `<content> ... </content>` düğümü
 * aranır; `<paragraph>` altındaki kendi kendine kapanan `<content ... />`
 * düğümleriyle karışmaması için kapanışı olmayan eşleşmeler atlanır.
 */
function readDocumentText(xml: string): string {
  const re = /<content((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let match: RegExpExecArray | null = re.exec(xml);
  while (match !== null) {
    const attrPart = match[1] ?? "";
    const selfClosing = attrPart.trimEnd().endsWith("/");
    if (!selfClosing) {
      const bodyStart = match.index + match[0].length;
      const closeIndex = findCloseOutsideCdata(xml, bodyStart, "</content>");
      const body = closeIndex === -1 ? xml.slice(bodyStart) : xml.slice(bodyStart, closeIndex);
      return readTextBody(body);
    }
    match = re.exec(xml);
  }
  return "";
}

/**
 * Kapanış etiketini CDATA blokları DIŞINDA arar. Belgenin düz metni "</content>"
 * gibi bir dizgi içerebileceği için düz `indexOf` yeterli değildir.
 */
function findCloseOutsideCdata(xml: string, from: number, closeTag: string): number {
  const lower = xml.toLowerCase();
  const target = closeTag.toLowerCase();
  let cursor = from;
  for (;;) {
    const cdataStart = lower.indexOf("<![cdata[", cursor);
    const closeIndex = lower.indexOf(target, cursor);
    if (closeIndex === -1) return -1;
    if (cdataStart === -1 || closeIndex < cdataStart) return closeIndex;
    const cdataEnd = xml.indexOf("]]>", cdataStart + 9);
    if (cdataEnd === -1) return closeIndex;
    cursor = cdataEnd + 3;
  }
}

function readDefaultStyle(xml: string): UdfTextStyle {
  const styles = extractElementBody(xml, "styles");
  const fallback: UdfTextStyle = {
    fontFamily: UDF_DEFAULT_FONT_FAMILY,
    fontSize: UDF_DEFAULT_FONT_SIZE,
  };
  if (!styles) return fallback;
  const styleMatch = /<style((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(styles.body);
  if (!styleMatch) return fallback;
  const attrs = parseAttributes(styleMatch[1] ?? "");
  const parsed = readStyle(attrs);
  return {
    fontFamily: parsed.fontFamily ?? fallback.fontFamily,
    fontSize: parsed.fontSize ?? fallback.fontSize,
    ...(parsed.bold !== undefined ? { bold: parsed.bold } : {}),
    ...(parsed.italic !== undefined ? { italic: parsed.italic } : {}),
    ...(parsed.underline !== undefined ? { underline: parsed.underline } : {}),
    ...(parsed.strikethrough !== undefined ? { strikethrough: parsed.strikethrough } : {}),
    ...(parsed.color !== undefined ? { color: parsed.color } : {}),
  };
}

function readPageFormat(xml: string): UdfPageFormat | undefined {
  const match = /<pageFormat((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(xml);
  if (!match) return undefined;
  const attrs = parseAttributes(match[1] ?? "");
  const pf: UdfPageFormat = {};
  const mediaSizeName = getNumberAttr(attrs, "mediaSizeName");
  if (mediaSizeName !== undefined) pf.mediaSizeName = mediaSizeName;
  const leftMargin = getNumberAttr(attrs, "leftMargin");
  if (leftMargin !== undefined) pf.leftMargin = leftMargin;
  const rightMargin = getNumberAttr(attrs, "rightMargin");
  if (rightMargin !== undefined) pf.rightMargin = rightMargin;
  const topMargin = getNumberAttr(attrs, "topMargin");
  if (topMargin !== undefined) pf.topMargin = topMargin;
  const bottomMargin = getNumberAttr(attrs, "bottomMargin");
  if (bottomMargin !== undefined) pf.bottomMargin = bottomMargin;
  const paperOrientation = getNumberAttr(attrs, "paperOrientation");
  if (paperOrientation !== undefined) pf.paperOrientation = paperOrientation;
  const headerFOffset = getNumberAttr(attrs, "headerFOffset");
  if (headerFOffset !== undefined) pf.headerFOffset = headerFOffset;
  const footerFOffset = getNumberAttr(attrs, "footerFOffset");
  if (footerFOffset !== undefined) pf.footerFOffset = footerFOffset;
  return Object.keys(pf).length > 0 ? pf : undefined;
}

function readStyle(attrs: XmlAttributes): UdfTextStyle {
  const style: UdfTextStyle = {};
  const family = getAttr(attrs, UDF_ATTR.fontFamily, "fontfamily", "font-family", "fontname");
  if (family !== undefined && family !== "") style.fontFamily = family;
  const size = getNumberAttr(attrs, UDF_ATTR.fontSize, "fontsize", "font-size");
  if (size !== undefined) style.fontSize = size;
  const bold = getBoolAttr(attrs, UDF_ATTR.bold);
  if (bold !== undefined) style.bold = bold;
  const italic = getBoolAttr(attrs, UDF_ATTR.italic);
  if (italic !== undefined) style.italic = italic;
  const underline = getBoolAttr(attrs, UDF_ATTR.underline);
  if (underline !== undefined) style.underline = underline;
  const strikethrough = getBoolAttr(attrs, UDF_ATTR.strikethrough, "strikeThrough");
  if (strikethrough !== undefined) style.strikethrough = strikethrough;
  // TEYİT GEREKİR: `foreground` değerinin biçimi (#RRGGBB / "r,g,b" / int).
  // Şu an ham dizgi olarak korunur.
  const color = getAttr(attrs, UDF_ATTR.foreground, "color", "fgcolor");
  if (color !== undefined && color !== "") style.color = color;
  return style;
}

function readLayout(attrs: XmlAttributes): UdfParagraphLayout | undefined {
  const layout: UdfParagraphLayout = {};
  const alignment = getNumberAttr(attrs, UDF_ATTR.alignment, "align");
  if (alignment !== undefined) {
    const mapped: UdfAlignment | undefined = SWING_ALIGNMENT_REVERSE[alignment];
    if (mapped) layout.alignment = mapped;
  }
  const leftIndent = getNumberAttr(attrs, UDF_ATTR.leftIndent);
  if (leftIndent !== undefined) layout.leftIndent = leftIndent;
  const rightIndent = getNumberAttr(attrs, UDF_ATTR.rightIndent);
  if (rightIndent !== undefined) layout.rightIndent = rightIndent;
  const firstLineIndent = getNumberAttr(attrs, UDF_ATTR.firstLineIndent);
  if (firstLineIndent !== undefined) layout.firstLineIndent = firstLineIndent;
  const spaceAbove = getNumberAttr(attrs, UDF_ATTR.spaceAbove);
  if (spaceAbove !== undefined) layout.spaceAbove = spaceAbove;
  const spaceBelow = getNumberAttr(attrs, UDF_ATTR.spaceBelow);
  if (spaceBelow !== undefined) layout.spaceBelow = spaceBelow;
  const lineSpacing = getNumberAttr(attrs, UDF_ATTR.lineSpacing);
  if (lineSpacing !== undefined) layout.lineSpacing = lineSpacing;
  return Object.keys(layout).length > 0 ? layout : undefined;
}

interface RawSegment {
  startOffset: number;
  length: number;
  style: UdfTextStyle;
}

interface RawParagraph {
  attrs: XmlAttributes;
  segments: RawSegment[];
}

/** `<elements>` gövdesindeki paragraf/biçim düğümlerini tarar. */
function scanParagraphNodes(elementsBody: string): RawParagraph[] {
  const nodeRe = /<(\/?)(paragraph|content)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  const paragraphs: RawParagraph[] = [];
  let current: RawParagraph | null = null;

  let match: RegExpExecArray | null = nodeRe.exec(elementsBody);
  while (match !== null) {
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const attrPart = match[3] ?? "";
    const selfClosing = attrPart.trimEnd().endsWith("/");

    if (tag === "paragraph") {
      if (closing) {
        if (current) {
          paragraphs.push(current);
          current = null;
        }
      } else {
        if (current) paragraphs.push(current); // kapanışı unutulmuş paragraf
        current = { attrs: parseAttributes(attrPart), segments: [] };
        if (selfClosing) {
          paragraphs.push(current);
          current = null;
        }
      }
    } else if (tag === "content" && !closing && current) {
      const attrs = parseAttributes(attrPart);
      const startOffset = getNumberAttr(attrs, UDF_ATTR.startOffset, "start", "offset");
      const length = getNumberAttr(attrs, UDF_ATTR.length, "len");
      if (startOffset !== undefined && length !== undefined && length >= 0) {
        current.segments.push({ startOffset, length, style: readStyle(attrs) });
      }
    }
    match = nodeRe.exec(elementsBody);
  }

  if (current) paragraphs.push(current);
  return paragraphs;
}

interface ParagraphParseResult {
  paragraphs: UdfParagraph[];
  /** Paragrafların ham metinde GERÇEKTEN kapsadığı UTF-16 kod birimi sayısı. */
  coveredLength: number;
  /** `<paragraph>` düğümü olduğu hâlde sınırları çözülemediği için atlanan düğüm sayısı. */
  skippedNodes: number;
}

function parseParagraphs(
  elementsBody: string,
  text: string,
  defaultStyle: UdfTextStyle,
): ParagraphParseResult {
  const raw = scanParagraphNodes(elementsBody);
  const result: UdfParagraph[] = [];
  // Kapsam ölçümü: aynı aralık iki kez sayılmasın diye en yüksek erişilen offset izlenir.
  let covered = 0;
  let skippedNodes = 0;

  for (const node of raw) {
    const bounds = resolveBounds(node, text.length);
    if (!bounds) {
      skippedNodes += 1;
      continue;
    }
    covered = Math.max(covered, bounds.start + bounds.length);

    let slice = text.slice(bounds.start, bounds.start + bounds.length);
    // Paragrafı izleyen ayırıcı, paragrafın uzunluğuna dâhildir; metinden çıkar.
    if (slice.endsWith(UDF_PARAGRAPH_SEPARATOR)) {
      slice = slice.slice(0, slice.length - UDF_PARAGRAPH_SEPARATOR.length);
    }

    const paragraph: UdfParagraph = { text: slice };
    const layout = readLayout(node.attrs);
    if (layout) paragraph.layout = layout;

    const { style, runs } = deriveStyles(node.segments, bounds.start, slice.length, defaultStyle);
    if (style) paragraph.style = style;
    if (runs.length > 0) paragraph.runs = runs;

    result.push(paragraph);
  }

  return { paragraphs: result, coveredLength: covered, skippedNodes };
}

function resolveBounds(node: RawParagraph, textLength: number): { start: number; length: number } | undefined {
  const attrStart = getNumberAttr(node.attrs, UDF_ATTR.startOffset, "start", "offset");
  const attrLength = getNumberAttr(node.attrs, UDF_ATTR.length, "len");
  if (attrStart !== undefined && attrLength !== undefined && attrLength >= 0) {
    const start = clamp(attrStart, 0, textLength);
    return { start, length: clamp(attrLength, 0, textLength - start) };
  }
  if (node.segments.length === 0) return undefined;
  const start = Math.min(...node.segments.map((s) => s.startOffset));
  const end = Math.max(...node.segments.map((s) => s.startOffset + s.length));
  const safeStart = clamp(start, 0, textLength);
  return { start: safeStart, length: clamp(end - safeStart, 0, textLength - safeStart) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/**
 * Biçim aralıklarından paragraf düzeyi biçim + fark aralıklarını türetir.
 * Paragrafın baskın (ilk) biçimi `style` olur; ondan farklı aralıklar `runs`
 * hâline gelir. Offsetler paragraf başına göre göreceli döner.
 */
function deriveStyles(
  segments: RawSegment[],
  paragraphStart: number,
  textLength: number,
  defaultStyle: UdfTextStyle,
): { style?: UdfTextStyle; runs: UdfStyleRun[] } {
  const clipped = segments
    .map((segment) => {
      const start = Math.max(0, segment.startOffset - paragraphStart);
      const end = Math.min(textLength, segment.startOffset - paragraphStart + segment.length);
      return { start, end, style: segment.style };
    })
    .filter((segment) => segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  if (clipped.length === 0) return { runs: [] };

  // Aynı biçme sahip bitişik aralıkları birleştir.
  const merged: typeof clipped = [];
  for (const segment of clipped) {
    const last = merged[merged.length - 1];
    if (last && last.end === segment.start && styleEquals(last.style, segment.style)) {
      last.end = segment.end;
    } else {
      merged.push({ ...segment });
    }
  }

  const baseFull = merged[0].style;
  const paragraphStyle = styleDiff(defaultStyle, baseFull);
  const runs: UdfStyleRun[] = [];
  for (const segment of merged.slice(1)) {
    if (styleEquals(segment.style, baseFull)) continue;
    runs.push({
      startOffset: segment.start,
      length: segment.end - segment.start,
      style: styleDiff(baseFull, segment.style),
    });
  }

  return { style: isEmptyStyle(paragraphStyle) ? undefined : paragraphStyle, runs };
}

/** `<elements>` yoksa/boşsa: düz metni satır sonlarından bölerek paragraf üret. */
function fallbackParagraphs(text: string): UdfParagraph[] {
  if (text.length === 0) return [];
  return text.split(UDF_PARAGRAPH_SEPARATOR).map((line) => ({ text: line }));
}
