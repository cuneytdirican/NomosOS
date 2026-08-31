import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * DAVET / PAROLA SIFIRLAMA TOKEN'LARI.
 *
 * HAM TOKEN HİÇBİR ZAMAN SAKLANMAZ. Veritabanına yalnızca SHA-256 özeti yazılır
 * (`PortalInvite.tokenHash`); ham değer yanıtta bir kez döner ve bir daha
 * üretilemez. Veritabanı sızsa bile elde edilen özetlerle hesap açılamaz veya
 * parola sıfırlanamaz.
 *
 * Neden bcrypt değil de SHA-256? Bu token'lar 32 baytlık KRİPTOGRAFİK RASTGELE
 * değerlerdir; parolalar gibi düşük entropili değil. Kaba kuvvet 2^256 uzayına
 * karşıdır, yavaş özet fonksiyonunun getireceği ek koruma yoktur; buna karşılık
 * her doğrulama isteğinde bcrypt maliyeti ödemek gereksiz bir DoS yüzeyi açardı.
 */

/** Yeni ham token — 32 bayt entropi, 64 hane hex. */
export function newPortalToken(): string {
  return randomBytes(32).toString("hex");
}

/** Ham token → saklanacak özet. */
export function hashPortalToken(raw: string): string {
  return createHash("sha256").update(raw.trim().toLowerCase()).digest("hex");
}

/**
 * İki özeti SABİT ZAMANDA karşılaştırır.
 *
 * Doğrulama veritabanı sorgusuyla (`where: { tokenHash }`) yapıldığı için
 * pratikte gerekmez; yine de elde iki özet varken `===` kullanmamak için
 * bırakılmıştır (uzunluk farkı erken döner, içerik farkı sızmaz).
 */
export function portalTokenHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
