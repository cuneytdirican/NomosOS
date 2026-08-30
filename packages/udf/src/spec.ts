/**
 * UDF format sabitleri.
 *
 * Bu dosya, formatın "sihirli dizgi"lerini tek noktada toplar. UDF resmî olarak
 * yayımlanmış bir spesifikasyona sahip DEĞİLDİR; aşağıdaki adların bir kısmı
 * gerçek UDF dosyaları incelenerek DOĞRULANMALIDIR. Doğrulama sonrasında
 * yalnızca bu dosyanın güncellenmesi yeterlidir.
 */

import type { UdfAlignment } from "./types";

/** UDF arşivi içindeki ana XML girdisi. Kesin bilgi. */
export const UDF_CONTENT_ENTRY = "content.xml";

/** Kök düğüm adı. Kesin bilgi. */
export const UDF_ROOT_TAG = "template";

/** TEYİT GEREKİR: UYAP'ın kabul ettiği güncel format_id değeri. 1.8 yaygın görülen değerdir. */
export const UDF_DEFAULT_FORMAT_ID = "1.8";

/** TEYİT GEREKİR: `<elements resolution="...">` değeri; UYAP dosyalarında 102 görülmüştür. */
export const UDF_DEFAULT_RESOLUTION = 102;

/** NomosOS'un ürettiği belgelerde varsayılan yazı tipi (Türk dilekçe geleneği). */
export const UDF_DEFAULT_FONT_FAMILY = "Times New Roman";
export const UDF_DEFAULT_FONT_SIZE = 12;

/**
 * Paragraf ayırıcı. Java `PlainDocument`/`StyledDocument` her zaman "\n" kullanır;
 * "\r\n" KULLANILMAZ. Kesin bilgi (Java Swing davranışı).
 */
export const UDF_PARAGRAPH_SEPARATOR = "\n";

/**
 * Java Swing `StyleConstants.ALIGN_*` sabitleri.
 * ALIGN_LEFT = 0, ALIGN_CENTER = 1, ALIGN_RIGHT = 2, ALIGN_JUSTIFIED = 3.
 * Kesin bilgi (Swing API'si), UDF'in bu sabitleri kullandığı ise TEYİT GEREKİR
 * (ancak format Swing tabanlı olduğu için yüksek olasılıklıdır).
 */
export const SWING_ALIGNMENT: Record<UdfAlignment, number> = {
  left: 0,
  center: 1,
  right: 2,
  justify: 3,
};

export const SWING_ALIGNMENT_REVERSE: Record<number, UdfAlignment> = {
  0: "left",
  1: "center",
  2: "right",
  3: "justify",
};

/**
 * XML öznitelik adları.
 *
 * TEYİT GEREKİR: Aşağıdaki adların BÜYÜK/küçük harf yazımı gerçek UDF
 * dosyalarıyla karşılaştırılmalıdır. Ayrıştırıcı (parser) tarafı zaten
 * büyük/küçük harf duyarsız çalışır; yalnızca YAZMA tarafı bu adlara bağlıdır.
 */
export const UDF_ATTR = {
  /** `<template format_id="1.8">` */
  formatId: "format_id",
  /** `<elements resolution="102">` */
  resolution: "resolution",
  /** `<content startOffset="0" length="12" />` — kesine yakın bilgi. */
  startOffset: "startOffset",
  length: "length",
  /** Karakter biçimi öznitelikleri. */
  fontFamily: "family",
  fontSize: "size",
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikethrough: "strikethrough",
  foreground: "foreground",
  /** Paragraf yerleşim öznitelikleri. */
  alignment: "Alignment",
  leftIndent: "LeftIndent",
  rightIndent: "RightIndent",
  firstLineIndent: "FirstLineIndent",
  spaceAbove: "SpaceAbove",
  spaceBelow: "SpaceBelow",
  lineSpacing: "LineSpacing",
} as const;

/**
 * NomosOS'a özgü, standart dışı yardımcı öznitelikler.
 *
 * TEYİT GEREKİR: Bunları `<paragraph>` üzerine yazıyoruz ki ayrıştırma tamamen
 * belirleyici olsun (özellikle boş paragraflarda alt `<content>` düğümü
 * bulunmayabilir). Java tarafındaki `MutableAttributeSet` bilinmeyen
 * öznitelikleri yok saymalıdır, ancak UYAP editörünün bunları sorunsuz
 * görmezden geldiği gerçek bir dosyayla test edilmelidir. Sorun çıkarsa
 * `EMIT_PARAGRAPH_OFFSETS` false yapılabilir; ayrıştırıcı bu durumda alt
 * `<content>` düğümlerinin birleşiminden paragraf sınırlarını türetir.
 */
export const EMIT_PARAGRAPH_OFFSETS = true;
