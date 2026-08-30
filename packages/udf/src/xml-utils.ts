/**
 * Bağımlılıksız, küçük ve dayanıklı XML yardımcıları.
 *
 * Neden tam bir XML ayrıştırıcı kullanmıyoruz: UDF'in content.xml yapısı çok dar
 * ve öngörülebilir (kök `<template>`, tek CDATA bloğu, düz `<paragraph>` /
 * `<content>` düğümleri). Harici bağımlılık (fast-xml-parser, xmldom vb.)
 * eklemek yerine bu düğümleri hedefli biçimde tarıyoruz. Node ve tarayıcı
 * ortamlarında `DOMParser` olmadan çalışır.
 */

/** XML metin düğümü için kaçış. */
export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** XML öznitelik değeri için kaçış (çift tırnak varsayılır). */
export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Satır sonu ve sekme, öznitelik normalizasyonunda boşluğa dönüşmesin diye
    // sayısal varlık olarak yazılır.
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");
}

/**
 * Metni CDATA bloğuna sarar. Metin "]]>" içeriyorsa blok bölünür; bu, CDATA
 * içinde "]]>" yazmanın tek standart yoludur.
 */
export function wrapCdata(text: string): string {
  const safe = text.split("]]>").join("]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  bull: "•",
  middot: "·",
  deg: "°",
  euro: "€",
  copy: "©",
  reg: "®",
  trade: "™",
  // Türkçe karakterler için sık kullanılan HTML varlıkları
  ccedil: "ç",
  Ccedil: "Ç",
  ouml: "ö",
  Ouml: "Ö",
  uuml: "ü",
  Uuml: "Ü",
  gbreve: "ğ",
  Gbreve: "Ğ",
  scedil: "ş",
  Scedil: "Ş",
  idotaccent: "İ",
  inodot: "ı",
};

/** XML/HTML varlıklarını çözer (adlandırılmış + sayısal/onaltılık). */
export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (match, body: string) => {
    if (body.charAt(0) === "#") {
      const isHex = body.charAt(1) === "x" || body.charAt(1) === "X";
      const digits = isHex ? body.slice(2) : body.slice(1);
      const code = parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? match : named;
  });
}

/** Ayrıştırılmış öznitelik torbası. Anahtarlar KÜÇÜK harfe indirgenmiştir. */
export type XmlAttributes = Record<string, string>;

/**
 * `startOffset="0" length="3" bold="true"` biçimindeki ham öznitelik dizgisini
 * ayrıştırır. Anahtarlar küçük harfe indirgenir; böylece gerçek UDF
 * dosyalarındaki büyük/küçük harf farklılıkları (Alignment / alignment) sorun
 * çıkarmaz.
 */
export function parseAttributes(raw: string): XmlAttributes {
  const attrs: XmlAttributes = {};
  if (!raw) return attrs;
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null = re.exec(raw);
  while (match !== null) {
    const rawValue = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : "";
    attrs[match[1].toLowerCase()] = decodeXmlEntities(rawValue);
    match = re.exec(raw);
  }
  return attrs;
}

/** Verilen adlardan ilk bulunanı döndürür (büyük/küçük harf duyarsız). */
export function getAttr(attrs: XmlAttributes, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = attrs[name.toLowerCase()];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Sayısal öznitelik okur; geçersizse `undefined` döner. */
export function getNumberAttr(attrs: XmlAttributes, ...names: string[]): number | undefined {
  const raw = getAttr(attrs, ...names);
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Mantıksal öznitelik okur. "true" / "1" / "yes" doğru kabul edilir. */
export function getBoolAttr(attrs: XmlAttributes, ...names: string[]): boolean | undefined {
  const raw = getAttr(attrs, ...names);
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return undefined;
}

/** Öznitelik torbasını XML dizgisine çevirir; `undefined` değerler atlanır. */
export function serializeAttributes(attrs: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    parts.push(`${key}="${escapeXmlAttr(String(value))}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** Belirli bir etiketin ilk açılışını + kapanışını bulur ve iç gövdesini döndürür. */
export function extractElementBody(
  xml: string,
  tagName: string,
): { attrs: XmlAttributes; body: string } | undefined {
  const openRe = new RegExp(`<${tagName}((?:[^>"']|"[^"]*"|'[^']*')*)>`, "i");
  const match = openRe.exec(xml);
  if (!match) return undefined;
  const attrPart = match[1] ?? "";
  const attrs = parseAttributes(attrPart);
  // Kendi kendine kapanan düğüm (`<elements />`) — gövde yok.
  if (attrPart.trimEnd().endsWith("/")) return { attrs, body: "" };
  const bodyStart = match.index + match[0].length;
  const closeIndex = xml.toLowerCase().indexOf(`</${tagName.toLowerCase()}>`, bodyStart);
  if (closeIndex === -1) return { attrs, body: xml.slice(bodyStart) };
  return { attrs, body: xml.slice(bodyStart, closeIndex) };
}

/**
 * Bir gövde içindeki tüm CDATA bloklarını birleştirerek döndürür. Hiç CDATA
 * yoksa gövde, varlıkları çözülmüş düz metin olarak döner (dayanıklılık için:
 * bazı üreticiler CDATA yerine kaçışlı metin yazabilir).
 */
export function readTextBody(body: string): string {
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  const chunks: string[] = [];
  let match: RegExpExecArray | null = cdataRe.exec(body);
  while (match !== null) {
    chunks.push(match[1]);
    match = cdataRe.exec(body);
  }
  if (chunks.length > 0) return chunks.join("");
  return decodeXmlEntities(body);
}
