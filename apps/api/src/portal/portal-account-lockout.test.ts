import { describe, expect, it } from "vitest";
import {
  CLEARED_ACCOUNT_LOCKOUT,
  accountLockRemainingSeconds,
  recordAccountFailure,
  type AccountLockoutState,
} from "./portal-account-lockout";
import {
  PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS,
  PORTAL_FAILURE_WINDOW_MINUTES,
  PORTAL_LOCKOUT_MINUTES,
} from "./portal.constants";

/**
 * HESAP KİLİDİNİN KALICI HÂLİ.
 *
 * Karar mantığı SAF'tır: hâl → yeni hâl. Kalıcılığı `PortalAuthService` yazar,
 * bu yüzden kilidin doğruluğu veritabanı olmadan sınanabilir.
 *
 * Bu sayaç, dar (IP ∧ e-posta) sayaçtan farklı olarak MEŞRU KULLANICIYI da
 * kilitleyebilen tek sayaçtır; eşiğinin belirgin biçimde yüksek olması
 * bilinçlidir (hedefli hizmet dışı bırakmayı pahalılaştırır).
 */
describe("portal hesap kilidi (kalıcı)", () => {
  const t0 = new Date("2026-08-31T10:00:00.000Z");
  const fresh: AccountLockoutState = {
    failedAttempts: 0,
    failureWindowEndsAt: null,
    lockedUntil: null,
  };

  it("eşiğin altındaki hatalar kilitlemez", () => {
    let state: AccountLockoutState = { ...fresh };
    for (let i = 0; i < PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS - 1; i += 1) {
      state = recordAccountFailure(state, t0);
    }
    expect(state.lockedUntil).toBeNull();
    expect(accountLockRemainingSeconds(state, t0)).toBe(0);
    expect(state.failedAttempts).toBe(PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS - 1);
  });

  it("eşiğe gelindiğinde kilit kurulur", () => {
    let state: AccountLockoutState = { ...fresh };
    for (let i = 0; i < PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS; i += 1) {
      state = recordAccountFailure(state, t0);
    }
    const remaining = accountLockRemainingSeconds(state, t0);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(PORTAL_LOCKOUT_MINUTES * 60);
    // Kilit kurulunca sayaç sıfırlanır: kilit bittiğinde temiz sayfa.
    expect(state.failedAttempts).toBe(0);
  });

  it("kilit süresi dolunca erişim açılır", () => {
    let state: AccountLockoutState = { ...fresh };
    for (let i = 0; i < PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS; i += 1) {
      state = recordAccountFailure(state, t0);
    }
    const after = new Date(t0.getTime() + PORTAL_LOCKOUT_MINUTES * 60_000 + 1_000);
    expect(accountLockRemainingSeconds(state, after)).toBe(0);
  });

  it("pencere kapandıktan sonra biriken hatalar unutulur", () => {
    // Eşiğin bir altına kadar hata yapılır…
    let state: AccountLockoutState = { ...fresh };
    for (let i = 0; i < PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS - 1; i += 1) {
      state = recordAccountFailure(state, t0);
    }
    // …sonra pencere kapanır ve yeni bir hata sayacı SIFIRDAN başlatır.
    const later = new Date(t0.getTime() + PORTAL_FAILURE_WINDOW_MINUTES * 60_000 + 1_000);
    state = recordAccountFailure(state, later);
    expect(state.failedAttempts).toBe(1);
    expect(accountLockRemainingSeconds(state, later)).toBe(0);
  });

  it("temizleme hâli sayacı ve kilidi birlikte düşürür", () => {
    expect(CLEARED_ACCOUNT_LOCKOUT.failedAttempts).toBe(0);
    expect(CLEARED_ACCOUNT_LOCKOUT.lockedUntil).toBeNull();
    expect(CLEARED_ACCOUNT_LOCKOUT.failureWindowEndsAt).toBeNull();
  });

  it("hesap eşiği, dar (IP ∧ e-posta) eşikten belirgin biçimde yüksektir", () => {
    // Hedefli kilitlemeyi pahalılaştıran asıl karar budur; sayı değişirse
    // gerekçenin de yeniden düşünülmesi gerekir.
    expect(PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS).toBeGreaterThanOrEqual(15);
  });
});
