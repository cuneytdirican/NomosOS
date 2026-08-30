/**
 * NomosOS Dilekçe Stüdyosu (Modül 22) çıktısını UDF belge modeline çevirir.
 *
 * Desteklenen basit HTML alt kümesi:
 *   - Blok: p, div, section, article, blockquote, h1–h6, li (ul/ol), br, pre
 *   - Satır içi: strong/b, em/i, u/ins, s/del/strike, span[style], font, a
 *   - Hizalama: `class="text-center"`, `style="text-align:right"`,
 *     imza bloğu için `class="imza"` / `class="signature"`
 *
 * Harici HTML ayrıştırıcı kullanılmaz; girdi bizim ürettiğimiz dar bir HTML
 * alt kümesidir ve etiket tarayıcı yaklaşımı Node'da bağımlılıksız çalışır.
 * Rastgele/gerçek dünya HTML'i için tasarlanmamıştır.
 */

import { UDF_DEFAULT_FONT_FAMILY, UDF_DEFAULT_FONT_SIZE } from "./spec";
import { mergeStyle, styleEquals } from "./style-utils";
import type {
  UdfAlignment,
  UdfDocument,
  UdfMetadata,
  UdfParagraph,
  UdfParagraphLayout,
  UdfStyleRun,
  UdfTextStyle,
} from "./types";
import { decodeXmlEntities, parseAttributes } from "./xml-utils";

export interface HtmlToUdfOptions {
  /** Belge genelinde geçerli varsayılan biçim. */
  defaultStyle?: UdfTextStyle;
  metadata?: UdfMetadata;
  /** h1/h2 başlıklarını ortala (Türk dilekçe geleneği). Varsayılan: true. */
  centerHeadings?: boolean;
  /** Liste öğelerinin girintisi. Varsayılan: 20. */
  listIndent?: number;
  /** Boş paragrafları koru (dikey boşluk). Varsayılan: true. */
  keepEmptyParagraphs?: boolean;
}

/** Blok bağlamı — paragraf flush edilirken geçerli yerleşim/biçmi belirler. */
interface BlockContext {
  tag: string;
  layout: UdfParagraphLayout;
  style: UdfTextStyle;
}

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "blockquote",
  "pre",
  "li",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/** İçeriği tamamen atlanan etiketler. */
const SKIP_TAGS = new Set(["script", "style", "head", "title"]);

/** Kapanış etiketi olmayan (void) etiketler — derinlik sayacını etkilemezler. */
const VOID_TAGS = new Set(["br", "hr", "img", "meta", "link", "input", "col", "area", "base"]);

const HEADING_SIZE_DELTA: Record<string, number> = {
  h1: 4,
  h2: 2,
  h3: 1,
  h4: 0,
  h5: 0,
  h6: 0,
};

/** Basit HTML'i UdfDocument'e çevirir. */
export function htmlToUdf(html: string, options: HtmlToUdfOptions = {}): UdfDocument {
  const defaultStyle: UdfTextStyle = {
    fontFamily: UDF_DEFAULT_FONT_FAMILY,
    fontSize: UDF_DEFAULT_FONT_SIZE,
    ...(options.defaultStyle ?? {}),
  };
  const baseFontSize = defaultStyle.fontSize ?? UDF_DEFAULT_FONT_SIZE;
  const centerHeadings = options.centerHeadings !== false;
  const listIndent = options.listIndent ?? 20;
  const keepEmpty = options.keepEmptyParagraphs !== false;

  const paragraphs: UdfParagraph[] = [];
  const blockStack: BlockContext[] = [];
  const inlineStack: UdfTextStyle[] = [];
  const listStack: Array<{ ordered: boolean; counter: number }> = [];

  let buffer = "";
  let runs: UdfStyleRun[] = [];
  let skipDepth = 0;

  const effectiveInlineStyle = (): UdfTextStyle =>
    inlineStack.reduce<UdfTextStyle>((acc, style) => mergeStyle(acc, style), {});

  const effectiveBlockLayout = (): UdfParagraphLayout =>
    blockStack.reduce<UdfParagraphLayout>((acc, block) => ({ ...acc, ...block.layout }), {});

  const effectiveBlockStyle = (): UdfTextStyle =>
    blockStack.reduce<UdfTextStyle>((acc, block) => mergeStyle(acc, block.style), {});

  const appendText = (raw: string): void => {
    // HTML boşluk daraltma: ardışık boşluklar tek boşluğa iner.
    let text = decodeXmlEntities(raw).replace(/\s+/g, " ");
    if (text === "") return;
    if (buffer === "") text = text.replace(/^ +/, "");
    if (text === "") return;
    const style = effectiveInlineStyle();
    const start = buffer.length; // UTF-16 kod birimi
    buffer += text;
    if (Object.keys(style).length === 0) return;
    const previous = runs[runs.length - 1];
    if (previous && previous.startOffset + previous.length === start && styleEquals(previous.style, style)) {
      previous.length += text.length;
    } else {
      runs.push({ startOffset: start, length: text.length, style });
    }
  };

  const flushParagraph = (force = false): void => {
    const text = buffer.replace(/\s+$/, "");
    const trimmedRuns = runs
      .map((run) => ({
        startOffset: run.startOffset,
        length: Math.min(run.length, Math.max(0, text.length - run.startOffset)),
        style: run.style,
      }))
      .filter((run) => run.length > 0 && run.startOffset < text.length);

    buffer = "";
    runs = [];

    if (text === "" && !(force && keepEmpty)) return;

    const paragraph: UdfParagraph = { text };
    const layout = effectiveBlockLayout();
    if (Object.keys(layout).length > 0) paragraph.layout = layout;
    const blockStyle = effectiveBlockStyle();
    if (Object.keys(blockStyle).length > 0) paragraph.style = blockStyle;
    if (trimmedRuns.length > 0) paragraph.runs = trimmedRuns;
    paragraphs.push(paragraph);
  };

  const tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null = tagRe.exec(html);

  while (match !== null) {
    if (skipDepth === 0 && match.index > cursor) {
      appendText(html.slice(cursor, match.index));
    }
    cursor = match.index + match[0].length;

    if (match[0].startsWith("<!--")) {
      match = tagRe.exec(html);
      continue;
    }

    const tag = (match[1] ?? "").toLowerCase();
    const attrPart = match[2] ?? "";
    const closing = match[0].charAt(1) === "/";
    const selfClosing = attrPart.trimEnd().endsWith("/");
    const attrs = parseAttributes(attrPart);

    if (SKIP_TAGS.has(tag)) {
      if (closing) skipDepth = Math.max(0, skipDepth - 1);
      else if (!selfClosing && !VOID_TAGS.has(tag)) skipDepth += 1;
      match = tagRe.exec(html);
      continue;
    }
    if (skipDepth > 0) {
      match = tagRe.exec(html);
      continue;
    }

    if (tag === "br") {
      flushParagraph(true);
    } else if (tag === "ul" || tag === "ol") {
      flushParagraph();
      if (closing) listStack.pop();
      else listStack.push({ ordered: tag === "ol", counter: 0 });
    } else if (BLOCK_TAGS.has(tag)) {
      flushParagraph();
      if (closing) {
        popBlock(blockStack, tag);
      } else {
        const context = createBlockContext(tag, attrs, {
          baseFontSize,
          centerHeadings,
          listIndent,
          listStack,
        });
        blockStack.push(context);
        if (tag === "li") {
          const marker = context.tag === "li" ? listMarker(listStack) : "";
          if (marker) appendText(marker);
        }
        if (selfClosing) popBlock(blockStack, tag);
      }
    } else {
      const inline = inlineStyleFor(tag, attrs, baseFontSize);
      if (inline) {
        if (closing) inlineStack.pop();
        else if (!selfClosing) inlineStack.push(inline);
      }
      // Satır içi hizalama bilgisi taşıyan span'lar blok hizalamasını etkiler.
      const alignment = alignmentFrom(attrs);
      if (alignment && !closing && blockStack.length > 0) {
        blockStack[blockStack.length - 1].layout.alignment = alignment;
      }
    }

    match = tagRe.exec(html);
  }

  if (skipDepth === 0 && cursor < html.length) appendText(html.slice(cursor));
  flushParagraph();

  return {
    metadata: { ...(options.metadata ?? {}) },
    defaultStyle,
    paragraphs,
  };
}

function popBlock(stack: BlockContext[], tag: string): void {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].tag === tag) {
      stack.splice(i, 1);
      return;
    }
  }
}

function listMarker(listStack: Array<{ ordered: boolean; counter: number }>): string {
  const current = listStack[listStack.length - 1];
  if (!current) return "";
  current.counter += 1;
  return current.ordered ? `${current.counter}. ` : "• ";
}

interface BlockContextInput {
  baseFontSize: number;
  centerHeadings: boolean;
  listIndent: number;
  listStack: Array<{ ordered: boolean; counter: number }>;
}

function createBlockContext(
  tag: string,
  attrs: Record<string, string>,
  input: BlockContextInput,
): BlockContext {
  const layout: UdfParagraphLayout = {};
  const style: UdfTextStyle = {};

  if (/^h[1-6]$/.test(tag)) {
    style.bold = true;
    const delta = HEADING_SIZE_DELTA[tag] ?? 0;
    if (delta !== 0) style.fontSize = input.baseFontSize + delta;
    if (input.centerHeadings && (tag === "h1" || tag === "h2")) layout.alignment = "center";
  }
  if (tag === "blockquote") {
    layout.leftIndent = input.listIndent * 2;
    style.italic = true;
  }
  if (tag === "li") {
    layout.leftIndent = input.listIndent * Math.max(1, input.listStack.length);
  }

  const alignment = alignmentFrom(attrs);
  if (alignment) layout.alignment = alignment;

  const inline = styleFromCssAttr(attrs["style"]);
  Object.assign(style, inline);

  const classes = (attrs["class"] ?? "").toLowerCase();
  if (/\b(imza|signature|imza-blok|signature-block)\b/.test(classes)) {
    layout.alignment = layout.alignment ?? "right";
  }
  if (/\b(bold|kalin|font-bold)\b/.test(classes)) style.bold = true;
  if (/\b(italic|italik)\b/.test(classes)) style.italic = true;
  if (/\b(underline|alti-cizili)\b/.test(classes)) style.underline = true;

  return { tag, layout, style };
}

/** class / style / align özniteliklerinden hizalama çıkarır. */
function alignmentFrom(attrs: Record<string, string>): UdfAlignment | undefined {
  const classes = (attrs["class"] ?? "").toLowerCase();
  if (/\b(text-center|center|ortala|ortali)\b/.test(classes)) return "center";
  if (/\b(text-right|right|saga|sag)\b/.test(classes)) return "right";
  if (/\b(text-justify|justify|iki-yana-yasli)\b/.test(classes)) return "justify";
  if (/\b(text-left|left|sola|sol)\b/.test(classes)) return "left";
  if (/\b(imza|signature|imza-blok|signature-block)\b/.test(classes)) return "right";

  const align = (attrs["align"] ?? "").toLowerCase();
  if (align === "center" || align === "right" || align === "left" || align === "justify") {
    return align as UdfAlignment;
  }

  const css = attrs["style"];
  if (css) {
    const match = /text-align\s*:\s*([a-z]+)/i.exec(css);
    const value = match ? match[1].toLowerCase() : "";
    if (value === "center" || value === "right" || value === "left") return value;
    if (value === "justify") return "justify";
  }
  return undefined;
}

/** Satır içi etiketin getirdiği karakter biçimi. Bilinmeyen etiketlerde undefined. */
function inlineStyleFor(
  tag: string,
  attrs: Record<string, string>,
  baseFontSize: number,
): UdfTextStyle | undefined {
  switch (tag) {
    case "strong":
    case "b":
      return { bold: true };
    case "em":
    case "i":
      return { italic: true };
    case "u":
    case "ins":
      return { underline: true };
    case "s":
    case "del":
    case "strike":
      return { strikethrough: true };
    case "a":
      return { underline: true };
    case "span":
    case "font": {
      const css = styleFromCssAttr(attrs["style"]);
      const classes = (attrs["class"] ?? "").toLowerCase();
      if (/\b(bold|kalin|font-bold)\b/.test(classes)) css.bold = true;
      if (/\b(italic|italik)\b/.test(classes)) css.italic = true;
      if (/\b(underline|alti-cizili)\b/.test(classes)) css.underline = true;
      const face = attrs["face"];
      if (face) css.fontFamily = face;
      const size = attrs["size"];
      if (size && /^\d+$/.test(size)) css.fontSize = baseFontSize + (Number(size) - 3);
      return css;
    }
    default:
      return undefined;
  }
}

/** `style="..."` içeriğinden karakter biçimi çıkarır. */
function styleFromCssAttr(css: string | undefined): UdfTextStyle {
  const style: UdfTextStyle = {};
  if (!css) return style;
  const weight = /font-weight\s*:\s*([a-z0-9]+)/i.exec(css);
  if (weight) {
    const value = weight[1].toLowerCase();
    style.bold = value === "bold" || value === "bolder" || Number(value) >= 600;
  }
  const fontStyle = /font-style\s*:\s*([a-z]+)/i.exec(css);
  if (fontStyle) style.italic = fontStyle[1].toLowerCase() === "italic";
  const decoration = /text-decoration[^:]*:\s*([^;]+)/i.exec(css);
  if (decoration) {
    const value = decoration[1].toLowerCase();
    if (value.includes("underline")) style.underline = true;
    if (value.includes("line-through")) style.strikethrough = true;
  }
  const size = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*(pt|px)?/i.exec(css);
  if (size) style.fontSize = Number(size[1]);
  const family = /font-family\s*:\s*([^;]+)/i.exec(css);
  if (family) style.fontFamily = family[1].trim().replace(/^["']|["']$/g, "");
  const color = /(?:^|[;\s])color\s*:\s*([^;]+)/i.exec(css);
  if (color) style.color = color[1].trim();
  return style;
}

/**
 * Dilekçe stüdyosunun markdown çıktısını UdfDocument'e çevirir.
 * Desteklenen: `#`–`###` başlıklar, `-`/`*` madde imleri, `1.` numaralı liste,
 * `**kalın**`, `*italik*`, boş satırla ayrılmış paragraflar.
 */
export function markdownToUdf(markdown: string, options: HtmlToUdfOptions = {}): UdfDocument {
  const defaultStyle: UdfTextStyle = {
    fontFamily: UDF_DEFAULT_FONT_FAMILY,
    fontSize: UDF_DEFAULT_FONT_SIZE,
    ...(options.defaultStyle ?? {}),
  };
  const baseFontSize = defaultStyle.fontSize ?? UDF_DEFAULT_FONT_SIZE;
  const centerHeadings = options.centerHeadings !== false;
  const listIndent = options.listIndent ?? 20;
  const keepEmpty = options.keepEmptyParagraphs !== false;

  const paragraphs: UdfParagraph[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (keepEmpty && paragraphs.length > 0) paragraphs.push({ text: "" });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const inline = parseInlineMarkdown(heading[2]);
      const paragraph: UdfParagraph = {
        text: inline.text,
        style: {
          bold: true,
          ...(level <= 3 ? { fontSize: baseFontSize + (4 - level) } : {}),
        },
      };
      if (centerHeadings && level <= 2) paragraph.layout = { alignment: "center" };
      if (inline.runs.length > 0) paragraph.runs = inline.runs;
      paragraphs.push(paragraph);
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      const marker = bullet ? "• " : `${numbered ? numbered[1] : "1"}. `;
      const body = bullet ? bullet[1] : numbered ? numbered[2] : "";
      const inline = parseInlineMarkdown(body);
      const shift = marker.length;
      paragraphs.push({
        text: marker + inline.text,
        layout: { leftIndent: listIndent },
        ...(inline.runs.length > 0
          ? { runs: inline.runs.map((run) => ({ ...run, startOffset: run.startOffset + shift })) }
          : {}),
      });
      continue;
    }

    const inline = parseInlineMarkdown(trimmed);
    paragraphs.push({
      text: inline.text,
      ...(inline.runs.length > 0 ? { runs: inline.runs } : {}),
    });
  }

  return { metadata: { ...(options.metadata ?? {}) }, defaultStyle, paragraphs };
}

/** `**kalın**` / `*italik*` / `__kalın__` / `_italik_` işaretlerini run'lara çevirir. */
export function parseInlineMarkdown(source: string): { text: string; runs: UdfStyleRun[] } {
  const re = /(\*\*|__)([^*_]+?)\1|(\*|_)([^*_]+?)\3/g;
  let text = "";
  let cursor = 0;
  const runs: UdfStyleRun[] = [];

  let match: RegExpExecArray | null = re.exec(source);
  while (match !== null) {
    text += source.slice(cursor, match.index);
    const isBold = match[1] !== undefined;
    const body = isBold ? match[2] : match[4];
    runs.push({
      startOffset: text.length,
      length: body.length,
      style: isBold ? { bold: true } : { italic: true },
    });
    text += body;
    cursor = match.index + match[0].length;
    match = re.exec(source);
  }
  text += source.slice(cursor);
  return { text, runs };
}
