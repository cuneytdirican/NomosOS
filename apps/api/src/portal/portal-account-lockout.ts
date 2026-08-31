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

/** Kalıcı sayaç alanlarının okunan hâli. */
export interface AccountLockoutState {
  failedAttempts: number;
  failureWindowEndsAt: Date | null;
  lockedUntil: Date | null;
}

/** Yazılacak yeni hâl (Prisma `data` nesnesine birebir uyar). */
export interface AccountLockoutUpdate {
  failedAttempts: number;
  failureWindowEndsAt: Date | null;
  lockedUntil: Date | null;
}

/** Hesap kilitliyse kalan saniye, değilse 0. */
export function accountLockRemainingSeconds(
  state: Pick<AccountLockoutState, "lockedUntil">,
  now: Date = new Date(),
): number {
  const until = state.lockedUntil?.getTime() ?? 0;
  if (until <= now.getTime()) return 0;
  return Math.max(1, Math.ceil((until - now.getTime()) / 1000));
}

/**
 * Başarısız denemeyi sayar ve eşiğe gelinirse kilidi kurar.
 *
 * Pencere dolmuşsa sayaç sıfırdan başlar: aylara yayılmış tek tük hatalar
 * birikip meşru kullanıcıyı kilitlemez.
 */
export function recordAccountFailure(
  state: AccountLockoutState,
  now: Date = new Date(),
): AccountLockoutUpdate {
  const windowMs = PORTAL_FAILURE_WINDOW_MINUTES * 60_000;
  const windowOpen =
    state.failureWindowEndsAt !== null && state.failureWindowEndsAt.getTime() > now.getTime();

  const failures = windowOpen ? state.failedAttempts + 1 : 1;

  if (failures >= PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + PORTAL_LOCKOUT_MINUTES * 60_000);
    return {
      // Sayaç sıfırlanır: kilit bittikten sonra kullanıcı temiz sayfayla başlar,
      // ama yeni bir hata dizisi yine kilitler.
      failedAttempts: 0,
      failureWindowEndsAt: new Date(lockedUntil.getTime() + windowMs),
      lockedUntil,
    };
  }

  return {
    failedAttempts: failures,
    failureWindowEndsAt: windowOpen
      ? state.failureWindowEndsAt
      : new Date(now.getTime() + windowMs),
    // Mevcut kilit korunur (kilitliyken zaten buraya gelinmez, ama hâli ezmeyiz).
    lockedUntil: state.lockedUntil,
  };
}

/** Başarılı girişte / parola sıfırlamada sayacı ve kilidi temizleyen hâl. */
export const CLEARED_ACCOUNT_LOCKOUT: AccountLockoutUpdate = {
  failedAttempts: 0,
  failureWindowEndsAt: null,
  lockedUntil: null,
};
