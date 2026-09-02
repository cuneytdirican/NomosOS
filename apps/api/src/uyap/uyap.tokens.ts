/**
 * UYAP Köprüsü token yardımcıları.
 *
 * Eklenti, NomosOS web oturumundan BAĞIMSIZ bir kimlikle çalışır: web arayüzünde
 * üretilen tek kullanımlık eşleştirme kodu, eklentiye tenant+kullanıcı kapsamlı
 * bir extension token çifti verir. Erişim jetonu 12 saat, yenileme jetonu
 * rotasyonludur (her yenilemede yeni çift verilir, eskisi iptal edilir).
 *
 * Ham token'lar asla saklanmaz — yalnızca SHA-256 özeti tutulur.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Erişim jetonunun ömrü (12 saat). */
export const UYAP_ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/**
 * Yenileme jetonunun ömrü (30 gün). Refresh rotasyonunda yenisi verilir;
 * 30 günden eski yenileme jetonuyla gelen istek kabul edilmez (guard'da
 * oluşturma zamanı kontrolü).
 */
export const UYAP_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** "nxt_" öneki — karışıklığı önler (JWT "ey..." ile başlar). */
export function generateExtensionToken(): string {
  return `nxt_${randomBytes(32).toString("hex")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Eşleştirme kodu üretimi — "AB12-CD34" biçimi.
 * Kod kısa ömürlüdür ve yalnızca oturum açmış kullanıcının kendisi görür;
 * yine de tahmin edilebilirlik olmasın diye 16 rastgele karakter (crypto).
 */
export function generatePairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // karışan karakterler (I,1,O,0) hariç
  const pick = () => alphabet[randomBytes(1)[0] % alphabet.length];
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`;
}

/** Sabit zamanlı karşılaştırma — kod sorgusu zamanlama sızıntısı vermez. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
