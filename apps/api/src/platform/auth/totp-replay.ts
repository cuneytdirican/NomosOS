/**
 * TOTP TEKRAR OYNATMA KORUMASI — denetim bulgusu İ-01.
 *
 * `authenticator.options = { window: 1 }` saat kayması toleransı verir; aynı
 * tolerans, kullanılan adım saklanmadığında AYNI kodun 90 saniyeye kadar tekrar
 * kabul edilmesine yol açar. Bu modül adım hesabını SAF tutar: kararla
 * `PlatformUser.lastTotpCounter` kalıcılığı serviste yapılır.
 */

/** TOTP adım uzunluğu (RFC 6238, 30 saniye). */
export const TOTP_STEP_MS = 30_000;

/**
 * Kodun MUTLAK adım sayacı: (şu anki adım) + (doğrulamanın deltası).
 *
 * `verifyDelta` dönüşünde delta -1/0/+1 olabilir; mutlak sayaç, ileriye dönük
 * tekrar oynatmayı adım bazında karşılaştırılabilir kılar.
 */
export function totpCounterAt(delta: number, nowMs: number): number {
  return Math.floor(nowMs / TOTP_STEP_MS) + delta;
}

/**
 * Adım TAZE Mİ? `lastUsed`'dan büyük/eşit her adım REDDEDİLİR (eşit dahil:
 * aynı adımın kodu bir kez kullanılır).
 */
export function isFreshTotp(counter: number, lastUsed: number | null): boolean {
  return lastUsed === null || counter > lastUsed;
}

/** Yeni saklanacak sayaç — var olanı asla geriye düşürmez. */
export function nextStoredCounter(counter: number, lastUsed: number | null): number {
  return lastUsed === null ? counter : Math.max(counter, lastUsed);
}
