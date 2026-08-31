/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ HESAP DÜZEYİNDE KİLİT — ÜÇ KİMLİK ALANI İÇİN TEK KARAR MANTIĞI          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Denetim bulgusu K-03: kilit mantığı YALNIZ portalda vardı. Büronun tüm
 * verisine bakan `User` (avukat) hesabında hiçbir kalıcı sayaç yoktu; tek
 * koruma `LoginThrottleGuard`'ın süreç içi `IP|e-posta` kovasıydı ve 100 farklı
 * çıkış IP'sinden dakikada 500 deneme yapılabiliyordu. Portalda doğru yazılmış
 * mantığın kiracı tarafında da bulunması için karar buraya taşındı; portal
 * modülü aynı fonksiyonları KENDİ eşikleriyle çağırır.
 *
 * Bu dosya SAFTIR: veritabanı okumaz, `new Date()` çağırmaz (saat parametredir).
 * Aldığı hâlden bir sonraki hâli hesaplar; kalıcılığı çağıran servis yazar.
 * Böylece karar birim testlenebilir ve yazma tek yerde kalır.
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

export interface LockoutPolicy {
  /** Kilidi tetikleyen ardışık hata sayısı. */
  maxFailedAttempts: number;
  /** Hataların biriktiği pencere (dakika). */
  failureWindowMinutes: number;
  /** Kilit süresi (dakika). */
  lockoutMinutes: number;
}

/** Hesap kilitliyse kalan saniye, değilse 0. */
export function lockRemainingSeconds(
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
export function recordFailure(
  state: AccountLockoutState,
  policy: LockoutPolicy,
  now: Date = new Date(),
): AccountLockoutUpdate {
  const windowMs = policy.failureWindowMinutes * 60_000;
  const windowOpen =
    state.failureWindowEndsAt !== null && state.failureWindowEndsAt.getTime() > now.getTime();

  const failures = windowOpen ? state.failedAttempts + 1 : 1;

  if (failures >= policy.maxFailedAttempts) {
    const lockedUntil = new Date(now.getTime() + policy.lockoutMinutes * 60_000);
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
export const CLEARED_LOCKOUT: AccountLockoutUpdate = {
  failedAttempts: 0,
  failureWindowEndsAt: null,
  lockedUntil: null,
};
