import { describe, expect, it } from "vitest";
import { MemoryAttemptCounter } from "../auth/attempt-counter";
import { PortalLockoutStore } from "./portal-lockout";
import { PORTAL_LOCKOUT_MINUTES, PORTAL_MAX_FAILED_ATTEMPTS } from "./portal.constants";

/**
 * HESAP KİLİDİ — spec §Kabul Kriterleri 7: "5 hata → 15 dk kilit, test edilebilir".
 *
 * Zaman `now` parametresiyle dışarıdan verilir; test sahte saat kurmaya
 * gerek duymadan kilidin başlangıcını ve bitişini doğrular.
 *
 * denetim bulgusu Ö-09: sayaç artık ORTAK bir kovadadır (üretimde Redis).
 * Test, kovayı açıkça enjekte eder — böylece hem kilit mantığı hem de sayacın
 * dışarıdan verilebilir olduğu (yani süreç belleğine ÇAKILI OLMADIĞI)
 * doğrulanır.
 */
describe("PortalLockoutStore", () => {
  const t0 = 1_800_000_000_000;
  const newStore = () => new PortalLockoutStore(new MemoryAttemptCounter());

  it("eşiğin altındaki hatalar kilitlemez", async () => {
    const store = newStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS - 1; i += 1) {
      await store.recordFailure("a@b.com", t0);
    }
    expect(await store.remainingLockSeconds("a@b.com", t0)).toBe(0);
  });

  it("beşinci hatada hesap kilitlenir", async () => {
    const store = newStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS; i += 1) {
      await store.recordFailure("a@b.com", t0);
    }
    const remaining = await store.remainingLockSeconds("a@b.com", t0);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(PORTAL_LOCKOUT_MINUTES * 60);
  });

  it("kilit süresi dolunca erişim açılır", async () => {
    const store = newStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS; i += 1) {
      await store.recordFailure("a@b.com", t0);
    }
    const after = t0 + PORTAL_LOCKOUT_MINUTES * 60_000 + 1_000;
    expect(await store.remainingLockSeconds("a@b.com", after)).toBe(0);
  });

  it("başarılı giriş sayacı temizler", async () => {
    const store = newStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS - 1; i += 1) {
      await store.recordFailure("a@b.com", t0);
    }
    await store.clear("a@b.com");
    await store.recordFailure("a@b.com", t0);
    expect(await store.remainingLockSeconds("a@b.com", t0)).toBe(0);
  });

  it("sayaç e-posta başınadır; bir hesabın kilidi diğerini etkilemez", async () => {
    const store = newStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS; i += 1) {
      await store.recordFailure("kurban@b.com", t0);
    }
    expect(await store.remainingLockSeconds("kurban@b.com", t0)).toBeGreaterThan(0);
    expect(await store.remainingLockSeconds("baskasi@b.com", t0)).toBe(0);
  });

  it("büyük/küçük harf ve boşluk farkı aynı hesabı gösterir", async () => {
    const store = newStore();
    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS; i += 1) {
      await store.recordFailure("  Kurban@B.com ", t0);
    }
    expect(await store.remainingLockSeconds("kurban@b.com", t0)).toBeGreaterThan(0);
  });

  /**
   * denetim bulgusu Ö-09 — REGRESYON: İKİ "REPLİKA" AYNI KOVAYI PAYLAŞIR.
   *
   * Eskiden sayaç `PortalLockoutStore` örneğinin İÇİNDEKİ `Map`'ti; iki API
   * örneği iki ayrı kova demekti ve 5 denemelik sınır fiilen 10 oluyordu. Bu
   * test o regresyonu yakalar: kova dışarıdan verildiği için iki ayrı store
   * örneği aynı sayacı görür.
   */
  it("aynı kovayı paylaşan iki örnek sınırı ÇARPMAZ (çok replikalı dağıtım)", async () => {
    const shared = new MemoryAttemptCounter();
    const replicaA = new PortalLockoutStore(shared);
    const replicaB = new PortalLockoutStore(shared);

    for (let i = 0; i < PORTAL_MAX_FAILED_ATTEMPTS - 1; i += 1) {
      await replicaA.recordFailure("kurban@b.com", t0);
    }
    expect(await replicaB.remainingLockSeconds("kurban@b.com", t0)).toBe(0);

    // Eşiğe ULAŞAN vuruş DİĞER örnekten gelir; kilit yine de kurulur.
    await replicaB.recordFailure("kurban@b.com", t0);
    expect(await replicaA.remainingLockSeconds("kurban@b.com", t0)).toBeGreaterThan(0);
  });
});
