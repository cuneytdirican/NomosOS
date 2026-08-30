/**
 * @nomosos/udf — UYAP Doküman Formatı (UDF) okuma/yazma kütüphanesi.
 *
 * DENEYSEL: UDF resmî olarak yayımlanmış bir spesifikasyona sahip değildir.
 * Bu paket, formatın kesin olarak bilinen kısımlarını uygular; belirsiz
 * ayrıntılar kod içinde `// TEYİT GEREKİR:` yorumlarıyla ve README'deki
 * "Doğrulanması gereken varsayımlar" listesinde işaretlenmiştir. Üretimde
 * kullanmadan önce gerçek bir UDF dosyasıyla ve UYAP Editör ile doğrulayın.
 */

export type {
  CreateUdfOptions,
  UdfAlignment,
  UdfDocument,
  UdfExtraFile,
  UdfInput,
  UdfMetadata,
  UdfPageFormat,
  UdfParagraph,
  UdfParagraphLayout,
  UdfStyleRun,
  UdfTextStyle,
} from "./types";

export {
  EMIT_PARAGRAPH_OFFSETS,
  SWING_ALIGNMENT,
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

export {
  buildContentXml,
  buildSegments,
  computeLayout,
  createUdf,
  normalizeDocument,
} from "./builder";
export type { DocumentLayout, ParagraphPlacement } from "./builder";

export { UdfParseError, parseContentXml, readContentXml, readUdf } from "./parser";

export { htmlToUdf, markdownToUdf, parseInlineMarkdown } from "./html-to-udf";
export type { HtmlToUdfOptions } from "./html-to-udf";

export {
  PETITION_SECTION_ORDER,
  PETITION_SECTION_TITLES,
  buildPetitionDocument,
  createPetitionUdf,
  formatPetitionDate,
} from "./petition-template";
export type { PetitionAttorney, PetitionInput, PetitionParty } from "./petition-template";

export { isEmptyStyle, mergeStyle, styleDiff, styleEquals } from "./style-utils";

export {
  decodeXmlEntities,
  escapeXmlAttr,
  escapeXmlText,
  getAttr,
  getBoolAttr,
  getNumberAttr,
  parseAttributes,
  serializeAttributes,
  wrapCdata,
} from "./xml-utils";

import { computeLayout } from "./builder";
import type { UdfDocument } from "./types";

/**
 * Belgenin düz metnini döndürür.
 *
 * ÖNCELİK: ayrıştırmadan gelen HAM CDATA metni (`rawText`). Yoksa (builder ile bellekte
 * kurulmuş belgeler) paragraflardan yeniden kurulur.
 *
 * DÜZELTİLDİ (hukuki/KVKK denetimi, bulgu 6): metin her koşulda paragraflardan yeniden
 * kuruluyordu. `<elements>` bloğu ham metnin tamamını kapsamayan bir dosyada kapsanmayan
 * kısım SESSİZCE düşüyor, dolayısıyla PII taraması o kısmı hiç görmüyordu. Bu fonksiyon
 * README'de açıkça "KVKK PII taraması" için gösterildiğinden, artık kaynak ham metindir.
 * Kapsam eksikse ayrıştırıcı `doc.parseWarnings` içine uyarı bırakır.
 */
export function udfToPlainText(doc: UdfDocument): string {
  if (typeof doc.rawText === "string") return doc.rawText;
  return computeLayout(doc.paragraphs).text;
}

/**
 * Dış (bulut) LLM'e veya indeksleyiciye gitmeden ÖNCE taranacak metni döndürür.
 *
 * `udfToPlainText`ten farkı: ayrıştırılmış bir belgede ham metin yoksa ya da paragraf
 * kapsamı eksikse SESSİZCE devam etmez — Türkçe hata fırlatır. Böylece taranmamış
 * TCKN/IBAN dışarı çıkamaz (docs/04, kabul kriteri 1-2).
 */
export function udfTextForPiiScan(doc: UdfDocument): string {
  const warnings = doc.parseWarnings ?? [];
  const coverageWarning = warnings.find((w) => w.includes("kapsamıyor"));
  if (coverageWarning && typeof doc.rawText !== "string") {
    throw new Error(
      `UDF düz metni güvenilir değil: ${coverageWarning} PII taraması yapılmadan bu belge işlenemez.`,
    );
  }
  return udfToPlainText(doc);
}
