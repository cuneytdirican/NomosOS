/**
 * Parser kayıt defteri.
 *
 * Bir UYAP sayfasında birden çok bölüm (sekme) aynı anda bulunabilir; bu yüzden
 * "tek sayfa türü" varsayılmaz — eşleşen TÜM parser'lar döner ve içerik betiği her biri
 * için ayrı düğme/aksiyon üretir.
 *
 * Yeni UYAP arayüz sürümü çıktığında: ilgili dosyada SELECTORS_V2 tanımlanır, V1 silinmez;
 * imza doğrulaması hangi sürümün tuttuğunu belirler ve `selectorVersion` aktarımla birlikte
 * backend'e gider (hangi verinin hangi selector setiyle okunduğu izlenebilir olur).
 */

import { dosyaDetayParser } from "./dosya-detay";
import { dosyaListesiParser } from "./dosya-listesi";
import { durusmaParser } from "./durusma";
import { evrakListesiParser } from "./evrak-listesi";
import { safahatParser } from "./safahat";
import type { PageContext } from "../../types/parser";
import type { UyapPageKind } from "../../types/uyap";

export { dosyaDetayParser, dosyaListesiParser, durusmaParser, evrakListesiParser, safahatParser };
export * from "./base";

/** Bu sürümde yayınlanan selector seti. */
export const SELECTOR_SET_VERSION = "v1";

/**
 * Öncelik sırası: dar kapsamlı (detay/safahat/evrak/duruşma) parser'lar önce denenir,
 * genel dosya listesi en sonda kalır.
 */
export const PARSER_ORDER: readonly UyapPageKind[] = [
  "DOSYA_DETAY",
  "SAFAHAT",
  "EVRAK_LISTESI",
  "DURUSMA",
  "DOSYA_LISTESI",
];

/** Sayfada eşleşen tüm parser türlerini döndürür. */
export function detectPageKinds(ctx: PageContext): UyapPageKind[] {
  const found: UyapPageKind[] = [];
  if (dosyaDetayParser.matches(ctx)) found.push("DOSYA_DETAY");
  if (safahatParser.matches(ctx)) found.push("SAFAHAT");
  if (evrakListesiParser.matches(ctx)) found.push("EVRAK_LISTESI");
  if (durusmaParser.matches(ctx)) found.push("DURUSMA");
  if (dosyaListesiParser.matches(ctx)) found.push("DOSYA_LISTESI");
  return PARSER_ORDER.filter((kind) => found.includes(kind));
}

/** Sayfa hiçbir parser'a uymuyorsa true (UYAP'ın ilgisiz bir ekranı). */
export function isUnknownPage(ctx: PageContext): boolean {
  return detectPageKinds(ctx).length === 0;
}
