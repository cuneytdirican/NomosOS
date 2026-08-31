import { describe, expect, it, vi } from "vitest";
import {
  MemoryAttemptCounter,
  RedisAttemptCounter,
  type AttemptCounterBackend,
} from "./attempt-counter";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ORTAK DENEME SAYACI — denetim bulgusu Ö-09 regresyonu                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Beş kimlik sayacı süreç belleğindeydi; üç replikalı kurulumda panel 2FA
 * sınırı 3'ten 9'a, portal giriş sınırı 5'ten 15'e çıkıyordu ve hiçbir uyarı
 * çıkmıyordu. Testler iki şeyi kanıtlar: (1) pencere/sıfırlama davranışı
 * doğrudur, (2) Redis arızasında API KAPANMAZ, süreç-içi kovaya düşer.
 */
const t0 = 1_800_000_000_000;

describe("MemoryAttemptCounter", () => {
  it("aynı pencerede sayar", async () => {
    const c = new MemoryAttemptCounter();
    expect((await c.hit("k", 60_000, t0)).count).toBe(1);
    expect((await c.hit("k", 60_000, t0 + 10)).count).toBe(2);
  });

  it("pencere dolunca sayaç sıfırlanır", async () => {
    const c = new MemoryAttemptCounter();
    await c.hit("k", 60_000, t0);
    await c.hit("k", 60_000, t0);
    expect((await c.hit("k", 60_000, t0 + 60_001)).count).toBe(1);
  });

  it("anahtarlar birbirine karışmaz", async () => {
    const c = new MemoryAttemptCounter();
    await c.hit("a", 60_000, t0);
    expect((await c.hit("b", 60_000, t0)).count).toBe(1);
  });

  it("reset sayacı temizler", async () => {
    const c = new MemoryAttemptCounter();
    await c.hit("k", 60_000, t0);
    await c.reset("k");
    expect(await c.peek("k", t0)).toBeNull();
  });

  it("peek sayacı ARTIRMAZ", async () => {
    const c = new MemoryAttemptCounter();
    await c.hit("k", 60_000, t0);
    expect((await c.peek("k", t0))?.count).toBe(1);
    expect((await c.peek("k", t0))?.count).toBe(1);
  });

  it("extend pencereyi uzatır ama sayacı değiştirmez", async () => {
    const c = new MemoryAttemptCounter();
    await c.hit("k", 1_000, t0);
    await c.extend("k", 900_000, t0);
    const seen = await c.peek("k", t0 + 5_000);
    expect(seen?.count).toBe(1);
    expect(seen?.resetAt).toBe(t0 + 900_000);
  });

  it("süresi geçmiş pencere peek'te görünmez", async () => {
    const c = new MemoryAttemptCounter();
    await c.hit("k", 1_000, t0);
    expect(await c.peek("k", t0 + 1_001)).toBeNull();
  });
});

describe("RedisAttemptCounter (paylaşılan kova)", () => {
  const fakeRedis = (overrides: Record<string, unknown> = {}) =>
    ({
      incr: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
      pttl: vi.fn().mockResolvedValue(30_000),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
      ...overrides,
    }) as any;

  it("ilk vuruşta pencereyi kurar", async () => {
    const redis = fakeRedis();
    const c = new RedisAttemptCounter(redis, new MemoryAttemptCounter());
    const hit = await c.hit("k", 60_000, t0);
    expect(hit).toEqual({ count: 1, resetAt: t0 + 60_000 });
    expect(redis.pexpire).toHaveBeenCalledWith("nomosos:attempt:k", 60_000);
  });

  it("sonraki vuruşlarda kalan süreyi okur (pencere UZAMAZ)", async () => {
    const redis = fakeRedis({ incr: vi.fn().mockResolvedValue(4) });
    const c = new RedisAttemptCounter(redis, new MemoryAttemptCounter());
    expect(await c.hit("k", 60_000, t0)).toEqual({ count: 4, resetAt: t0 + 30_000 });
  });

  it("TTL kaybolmuşsa pencere yeniden kurulur (sayaç sonsuz yaşamaz)", async () => {
    const redis = fakeRedis({ incr: vi.fn().mockResolvedValue(2), pttl: vi.fn().mockResolvedValue(-1) });
    const c = new RedisAttemptCounter(redis, new MemoryAttemptCounter());
    expect(await c.hit("k", 60_000, t0)).toEqual({ count: 2, resetAt: t0 + 60_000 });
  });

  /**
   * REDIS ARIZASI API'Yİ KAPATMAZ. Bu, Ö-09 düzeltmesinin en önemli
   * kısıtıdır: sayaç Redis'e taşındı diye Redis KRİTİK BAĞIMLILIK olmadı.
   */
  it("Redis hata verirse süreç-içi kovaya düşer, İSTİSNA FIRLATMAZ", async () => {
    const redis = fakeRedis({ incr: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) });
    const fallback: AttemptCounterBackend = new MemoryAttemptCounter();
    const c = new RedisAttemptCounter(redis, fallback);
    expect((await c.hit("k", 60_000, t0)).count).toBe(1);
    expect((await c.hit("k", 60_000, t0)).count).toBe(2);
  });

  /**
   * BULGUNUN ÇEKİRDEĞİ: iki "replika" AYNI kovayı görür. Süreç-içi Map ile bu
   * imkânsızdı; sınır replika sayısıyla çarpılıyordu.
   */
  it("iki örnek aynı Redis kovasını paylaşır (sınır ÇARPILMAZ)", async () => {
    let value = 0;
    const shared = fakeRedis({
      incr: vi.fn().mockImplementation(async () => (value += 1)),
      pttl: vi.fn().mockResolvedValue(30_000),
    });
    const replicaA = new RedisAttemptCounter(shared, new MemoryAttemptCounter());
    const replicaB = new RedisAttemptCounter(shared, new MemoryAttemptCounter());

    await replicaA.hit("login|1.2.3.4|a@b.com", 60_000, t0);
    await replicaB.hit("login|1.2.3.4|a@b.com", 60_000, t0);
    const third = await replicaA.hit("login|1.2.3.4|a@b.com", 60_000, t0);
    expect(third.count).toBe(3);
  });
});
