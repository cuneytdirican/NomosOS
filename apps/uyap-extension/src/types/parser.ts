/**
 * Parser katmanının sözleşme tipleri.
 *
 * TASARIM İLKESİ — SESSİZ YANLIŞ VERİ ASLA:
 * Bir parser ya doğruladığı yapıdan tipli veri döner (`ok: true`) ya da hangi
 * selector'ın kırıldığını açıkça bildirerek başarısız olur (`ok: false`).
 * Yarı dolu, tahmini veya kısmen okunmuş sonuç ÜRETİLMEZ.
 */

import type { UyapPageKind } from "./uyap";

/** Kırılan tek bir selector/alan raporu — parser bakımının birincil sinyali. */
export interface SelectorIssue {
  /** Mantıksal alan adı (ör. "dosyaNo", "safahatTablosu"). */
  readonly field: string;
  /** Denenen CSS selector veya sütun başlığı eşleşmesi. */
  readonly selector: string;
  /** Ne beklendiğinin insan okunur açıklaması (Türkçe). */
  readonly expected: string;
  /** Hatanın geçtiği kapsam (ör. "satır 3"). */
  readonly scope?: string;
}

export type ParseFailureCode =
  /** Sayfa imzası tutmadı: beklenen kök yapı/tablo yok → parse hiç denenmez. */
  | "PAGE_SIGNATURE_MISMATCH"
  /** Zorunlu sütun/alan bulunamadı (UYAP DOM'u değişmiş olabilir). */
  | "REQUIRED_FIELD_MISSING"
  /** Yapı doğru ama içerik beklenen biçimde değil (ör. tarih ayrıştırılamadı). */
  | "UNEXPECTED_STRUCTURE"
  /** Yapı doğru, hiç kayıt yok — çağıran bunu "veri yok" olarak ele alır. */
  | "EMPTY_RESULT";

export interface ParseFailure {
  readonly code: ParseFailureCode;
  /** Kullanıcıya/loga gösterilecek Türkçe mesaj. */
  readonly message: string;
  /** Kırılan selector'lar — eklenti bakımında doğrudan yol gösterir. */
  readonly issues: readonly SelectorIssue[];
}

export interface ParseSuccess<T> {
  readonly ok: true;
  readonly kind: UyapPageKind;
  readonly selectorVersion: string;
  readonly url: string;
  readonly parsedAt: string;
  readonly data: T;
  /** Zorunlu olmayan alanlar okunamadıysa buraya düşer; veri yine de güvenilirdir. */
  readonly warnings: readonly SelectorIssue[];
}

export interface ParseError {
  readonly ok: false;
  readonly kind: UyapPageKind;
  readonly selectorVersion: string;
  readonly url: string;
  readonly parsedAt: string;
  readonly failure: ParseFailure;
}

export type ParseResult<T> = ParseSuccess<T> | ParseError;

/** Parser'a verilen sayfa bağlamı (test edilebilirlik için Document dışarıdan gelir). */
export interface PageContext {
  readonly doc: Document;
  readonly url: string;
}

/** Sayfa imzası tanımı — parse'tan ÖNCE doğrulanır. */
export interface PageSignature {
  readonly kind: UyapPageKind;
  readonly selectorVersion: string;
  /** En az biri eşleşmeli; hiçbiri eşleşmezse sayfa bu parser'ın sayfası değildir. */
  readonly urlHints: readonly RegExp[];
  /** URL ipuçları tutmasa bile bu düğümlerin varlığı sayfayı doğrular. */
  readonly requiredNodes: readonly RequiredNode[];
}

export interface RequiredNode {
  readonly field: string;
  /** Sırayla denenen selector adayları (ilk eşleşen kullanılır). */
  readonly selectors: readonly string[];
  /** Beklenen en az düğüm sayısı (varsayılan 1). */
  readonly min?: number;
  readonly expected: string;
}

/** Tüm parser'ların uyduğu arayüz. */
export interface UyapParser<T> {
  readonly kind: UyapPageKind;
  readonly selectorVersion: string;
  /**
   * Hafif ön eleme: sayfa bu parser'a ait olabilir mi?
   * `true` dönmesi verinin okunabileceğini GARANTİ ETMEZ — garanti `parse()` içindir.
   */
  matches(ctx: PageContext): boolean;
  parse(ctx: PageContext): ParseResult<T>;
}
