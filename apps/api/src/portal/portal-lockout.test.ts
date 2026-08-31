import { describe, expect, it } from "vitest";
import { PortalLockoutStore } from "./portal-lockout";
import { PORTAL_LOCKOUT_MINUTES, PORTAL_MAX_FAILED_ATTEMPTS } from "./portal.constants";

/**
 * HESAP KİLİDİ — spec §Kabul Kriterleri 7: "5 hata → 15 dk kilit, test edilebilir".
 *
 * Zaman `now` parametresiyle dışarıdan verilir; test sahte saat kurmaya
 * gerek duymadan kilidin başlangıcını ve bitişini doğrular.
 */
describe("PortalLockoutStore", () => {
  const t0 = 1_800_000_000_000;

  it("eşiğin altındaki hatalar kilitlemez", () => {
    const store = new PortalLockoutStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS - 1; i += 1) {
      store.recordFailure("a@b.com", t0);
    }
    expect(store.remainingLockSeconds("a@b.com", t0)).toBe(0);
  });

  it("beşinci hatada hesap kilitlenir", () => {
    const store = new PortalLockoutStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS; i += 1) {
      store.recordFailure("a@b.com", t0);
    }
    const remaining = store.remainingLockSeconds("a@b.com", t0);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(PORTAL_LOCKOUT_MINUTES * 60);
  });

  it("kilit süresi dolunca erişim açılır", () => {
    const store = new PortalLockoutStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS; i += 1) {
      store.recordFailure("a@b.com", t0);
    }
    const after = t0 + PORTAL_LOCKOUT_MINUTES * 60_000 + 1_000;
    expect(store.remainingLockSeconds("a@b.com", after)).toBe(0);
  });

  it("başarılı giriş sayacı temizler", () => {
    const store = new PortalLockoutStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS - 1; i += 1) {
      store.recordFailure("a@b.com", t0);
    }
    store.clear("a@b.com");
    store.recordFailure("a@b.com", t0);
    expect(store.remainingLockSeconds("a@b.com", t0)).toBe(0);
  });

  it("sayaç e-posta başınadır; bir hesabın kilidi diğerini etkilemez", () => {
    const store = new PortalLockoutStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS; i += 1) {
      store.recordFailure("kurban@b.com", t0);
    }
    expect(store.remainingLockSeconds("kurban@b.com", t0)).toBeGreaterThan(0);
    expect(store.remainingLockSeconds("baskasi@b.com", t0)).toBe(0);
  });

  it("büyük/küçük harf ve boşluk farkı aynı hesabı gösterir", () => {
    const store = new PortalLockoutStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS; i += 1) {
      store.recordFailure("  Kurban@B.com ", t0);
    }
    expect(store.remainingLockSeconds("kurban@b.com", t0)).toBeGreaterThan(0);
  });
});
