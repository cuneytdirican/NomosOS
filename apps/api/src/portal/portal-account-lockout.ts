import {
  PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS,
  PORTAL_FAILURE_WINDOW_MINUTES,
  PORTAL_LOCKOUT_MINUTES,
} from "./portal.constants";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ HESAP DÜZEYİNDE KİLİT — ARTIK VERİTABANINDA                              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Denetim bulgusu 11: kilit ve hız sınırı süreç belleğindeydi. Sonucu şuydu —
 * süreç yeniden başladığında kilit düşüyor, çok örnekli dağıtımda koruma örnek
 * sayısı kadar zayıflıyordu. Gerekçe "`PortalUser`'da alan yok" idi; alanlar
 * artık var (`failedAttempts` · `failureWindowEndsAt` · `lockedUntil`).
 *
 * Bu dosya SAF karar mantığıdır: veritabanı okumaz, saat okumaz. Aldığı hâlden
 * bir sonraki hâli hesaplar; kalıcılığı `PortalAuthService` yazar. Böylece
 * karar birim testlenebilir, yazma tek yerde kalır.
 *
 * EŞİK NEDEN YÜKSEK: bu sayaç, denemenin nereden geldiğine BAKMAZ — yani meşru
 * kullanıcıyı da kilitleyebilen tek sayaçtır (bkz. portal.constants.ts,
 * "İKİ AYRI SAYAÇ"). Dar ve sıkı olan IP ∧ e-posta sayacıdır.
 */

export type { AccountLockoutState, AccountLockoutUpdate } from "../common/account-lockout";
import {
  CLEARED_LOCKOUT,
  lockRemainingSeconds,
  recordFailure,
  type AccountLockoutState,
  type AccountLockoutUpdate,
  type LockoutPolicy,
} from "../common/account-lockout";

/**
 * PORTAL EŞİKLERİ. Karar mantığı `common/account-lockout.ts`tedir ve kiracı
 * (avukat) tarafıyla PAYLAŞILIR — denetim bulgusu K-03: aynı korumanın büro
 * hesaplarında hiç bulunmaması, mantığın portala gömülü olmasından geliyordu.
 */
export const PORTAL_LOCKOUT_POLICY: LockoutPolicy = {
  maxFailedAttempts: PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS,
  failureWindowMinutes: PORTAL_FAILURE_WINDOW_MINUTES,
  lockoutMinutes: PORTAL_LOCKOUT_MINUTES,
};

/** Hesap kilitliyse kalan saniye, değilse 0. */
export function accountLockRemainingSeconds(
  state: Pick<AccountLockoutState, "lockedUntil">,
  now: Date = new Date(),
): number {
  return lockRemainingSeconds(state, now);
}

/** Başarısız denemeyi sayar ve eşiğe gelinirse kilidi kurar. */
export function recordAccountFailure(
  state: AccountLockoutState,
  now: Date = new Date(),
): AccountLockoutUpdate {
  return recordFailure(state, PORTAL_LOCKOUT_POLICY, now);
}

/** Başarılı girişte / parola sıfırlamada sayacı ve kilidi temizleyen hâl. */
export const CLEARED_ACCOUNT_LOCKOUT: AccountLockoutUpdate = CLEARED_LOCKOUT;
