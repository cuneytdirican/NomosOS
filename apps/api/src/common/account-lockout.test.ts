/**
 * K-03 REGRESYON TESTİ — kiracı (avukat) hesap kilidi.
 *
 * Bulgu: büronun TÜM verisine bakan `User` hesabında kalıcı kilit sayacı
 * YOKTU; yalnız süreç-içi `IP|e-posta` kovası vardı ve 100 çıkış IP'sinden
 * dakikada 500 deneme yapılabiliyordu. Oysa `PortalUser` 20 denemede
 * kilitleniyordu. Karar mantığı `common/account-lockout.ts`'e alındı; bu
 * test sayacın kiracı tarafında da gerçekten ÇALIŞTIĞINI kanıtlar:
 *  1) saf kilit mantığının kendisi,
 * 2) auth servisinin/şemanın kararı gerçekten kullandığı (kaynak taahhüdü).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLEARED_LOCKOUT,
  lockRemainingSeconds,
  recordFailure,
  type LockoutPolicy,
} from "./account-lockout";

/** auth.constants.ts'teki TENANT_LOCKOUT_POLICY ile aynı değerler. */
const POLICY: LockoutPolicy = { maxFailedAttempts: 5, failureWindowMinutes: 15, lockoutMinutes: 30 };

const NOW = new Date("2026-08-31T12:00:00.000Z");
const S = (over: Partial<{ failedAttempts: number; failureWindowEndsAt: Date | null; lockedUntil: Date | null }> = {}) => ({
  failedAttempts: 0,
  failureWindowEndsAt: null,
  lockedUntil: null,
  ...over,
});

describe("K-03: kilit mantığı — kiracı tarafında portalkiyle AYNI çalışır", () => {
  it("5 ardışık hata kilidi kurar; sayaç 5. hatada sıfırlanır", () => {
    let state = S();
    for (let i = 1; i <= 4; i++) {
      state = recordFailure(state, POLICY, NOW);
      expect(state.failedAttempts).toBe(i);
      expect(state.lockedUntil).toBeNull();
    }
    const locked = recordFailure(state, POLICY, NOW);
    expect(locked.lockedUntil).not.toBeNull();
    expect(locked.failedAttempts).toBe(0);
    expect(lockRemainingSeconds(locked, NOW)).toBe(30 * 60);
  });

  it("kilitliyken giriş denemesi reddedilir; kilit süresi dolunca geçer", () => {
    const locked = recordFailure(
      S({ failedAttempts: 4, failureWindowEndsAt: new Date(NOW.getTime() + 60_000) }),
      POLICY,
      NOW,
    );
    expect(locked.lockedUntil).not.toBeNull();
    expect(lockRemainingSeconds(locked, NOW)).toBeGreaterThan(0);
    const after = new Date(NOW.getTime() + 30 * 60_000 + 1000);
    expect(lockRemainingSeconds(locked, after)).toBe(0);
  });

  it("pencere dolmuşsa sayaç yeniden başlar — aylara yayılmış hatalar kilitlemez", () => {
    const stale = S({ failedAttempts: 4, failureWindowEndsAt: new Date(NOW.getTime() - 60_000) });
    const next = recordFailure(stale, POLICY, NOW);
    expect(next.failedAttempts).toBe(1);
    expect(next.lockedUntil).toBeNull();
  });

  it("CLEARED_LOCKOUT parola değişiminde/sıfırlamada tam temizlik verir", () => {
    expect(CLEARED_LOCKOUT).toEqual({ failedAttempts: 0, failureWindowEndsAt: null, lockedUntil: null });
  });
});

describe("K-03: kaynak taahhüdü — karar kiracı yoluna GERÇEKTEN bağlı", () => {
  const AUTH = readFileSync(join(process.cwd(), "src", "auth", "auth.service.ts"), "utf-8");
  const SCHEMA = readFileSync(
    join(process.cwd(), "..", "..", "packages", "db", "prisma", "schema.prisma"),
    "utf-8",
  );

  it("login ve changePassword kilit kontrolünü yapar; hata kaydı kalıcı sayaca yazar", () => {
    expect(AUTH).toContain("lockRemainingSeconds(user)");
    expect(AUTH).toContain("lockRemainingSeconds(record)");
    expect(AUTH).toContain("recordFailure(user, TENANT_LOCKOUT_POLICY)");
  });

  it("changePassword oturum damgasını tazeler (tüm oturumlar düşer)", () => {
    expect(AUTH).toContain("sessionsValidFrom: new Date()");
  });

  it("logout sunucu tarafında sessionsValidFrom tazeler (tüm oturumlar düşer)", () => {
    expect(AUTH).toMatch(/async logout\(/);
    // logout gövdesi sessionsValidFrom yazar (tokenVersion artırımı değil).
    const logoutBody = AUTH.slice(AUTH.indexOf("async logout("), AUTH.indexOf("async changePassword("));
    expect(logoutBody).toContain("sessionsValidFrom: new Date()");
    expect(logoutBody).toContain('"LOGOUT"');
  });

  it("User modeli kalıcı sayaç alanlarını taşıyor (şema taahhüdü)", () => {
    const userBlock = SCHEMA.slice(
      SCHEMA.indexOf("model User {"),
      SCHEMA.indexOf("\nmodel ", SCHEMA.indexOf("model User {") + 1),
    );
    expect(userBlock).toMatch(/failedAttempts\s+Int\s+@default\(0\)/);
    expect(userBlock).toMatch(/lockedUntil\s+DateTime\?/);
    expect(userBlock).toMatch(/sessionsValidFrom\s+DateTime\?/);
  });
});
