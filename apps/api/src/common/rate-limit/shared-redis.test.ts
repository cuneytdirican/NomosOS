import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  readBackendChoice,
  resetSharedRateLimitRedisForTests,
  sharedRateLimitRedis,
} from "./shared-redis";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ Ö-09 ENTEGRASYONU — İKİ SAYAÇ, TEK BAĞLANTI                              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Ö-09 iki ajan tarafından paralel çözüldü; iki sayaç arayüzü doğdu ve HER
 * BİRİ kendi `new IORedis(...)` çağrısını yaptı. Bu testler birleştirmenin
 * geri alınmasını yakalar: yeni bir `new IORedis` istek yoluna sızarsa ya da
 * `RATE_LIMIT_BACKEND` yorumu ayrışırsa kırılır.
 */
afterEach(() => resetSharedRateLimitRedisForTests());

describe("RATE_LIMIT_BACKEND yorumu tek yerdedir", () => {
  it("varsayılan auto'dur; bilinmeyen değer auto sayılır", () => {
    expect(readBackendChoice({})).toBe("auto");
    expect(readBackendChoice({ RATE_LIMIT_BACKEND: "  AUTO " })).toBe("auto");
    expect(readBackendChoice({ RATE_LIMIT_BACKEND: "sqlite" })).toBe("auto");
  });

  it("memory ve redis açıkça tanınır", () => {
    expect(readBackendChoice({ RATE_LIMIT_BACKEND: "MEMORY" })).toBe("memory");
    expect(readBackendChoice({ RATE_LIMIT_BACKEND: "redis" })).toBe("redis");
  });

  it("memory: Redis'e hiç bağlanılmaz", () => {
    const res = sharedRateLimitRedis({ RATE_LIMIT_BACKEND: "memory", REDIS_URL: "redis://x:6379" });
    expect(res.client).toBeNull();
    expect(res.reason).toContain("memory");
  });

  it("auto + REDIS_URL yok: süreç-içine düşer, FIRLATMAZ", () => {
    const res = sharedRateLimitRedis({});
    expect(res.client).toBeNull();
    expect(res.reason).toContain("REDIS_URL");
  });

  it("redis + geçersiz URL: SESSİZCE düşmez, açılışı durdurur", () => {
    expect(() =>
      sharedRateLimitRedis({ RATE_LIMIT_BACKEND: "redis", REDIS_URL: "http://localhost:6379" })
    ).toThrow(/sessizce süreç-içine düşürülmez/);
    resetSharedRateLimitRedisForTests();
    expect(() => sharedRateLimitRedis({ RATE_LIMIT_BACKEND: "redis" })).toThrow(/REDIS_URL/);
  });

  it("SCHEDULER_DISABLED oran sınırı sayacını KAPATMAZ", () => {
    // Gece işlerini kapatmak, güvenlik sayaçlarını replika sayısıyla çarpmak
    // anlamına gelmemelidir. `resolveRedisConfig` bu bayrağa bakar; burada
    // bilinçli olarak bastırılır — bastırma kalkarsa bu test kırılır.
    const res = sharedRateLimitRedis({
      SCHEDULER_DISABLED: "true",
      REDIS_URL: "redis://localhost:6379",
    });
    expect(res.client).not.toBeNull();
    res.client?.disconnect();
  });
});

describe("istek yolunda TEK bağlantı açılır", () => {
  const src = path.resolve(process.cwd(), "src");

  it("aynı çağrı iki kez aynı örneği döner", () => {
    const env = { REDIS_URL: "redis://localhost:6379" };
    const a = sharedRateLimitRedis(env);
    const b = sharedRateLimitRedis(env);
    expect(a.client).toBe(b.client);
    a.client?.disconnect();
  });

  it("sayaç dosyalarının hiçbiri kendi başına IORedis kurmaz", () => {
    // Bağlantı kurma yetkisi YALNIZ `shared-redis.ts`tedir (zamanlayıcının
    // BullMQ bağlantısı ayrı bir konudur ve `scheduler/` altında yaşar).
    const counters = [
      path.join(src, "auth", "attempt-counter.ts"),
      path.join(src, "common", "rate-limit", "counter-store.ts"),
    ];
    // Kontrol İMPORT üzerindendir, `new IORedis` metni üzerinden değil:
    // ioredis'i YALNIZCA tip olarak içe aktaran bir dosya bağlantı KURAMAZ,
    // ve bu kural yorum metinlerinden etkilenmez.
    const valueImport = /^\s*import\s+(?!type\b)[^;]*from\s+["']ioredis["']/m;
    for (const file of counters) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, `${path.basename(file)} ioredis'i DEĞER olarak içe aktarıyor`).not.toMatch(
        valueImport
      );
      expect(source).toContain("sharedRateLimitRedis");
    }
    // Kuralın gerçekten ayırt ettiğini kanıtla: bağlantıyı kuran dosya eşleşir.
    expect(fs.readFileSync(path.join(src, "common", "rate-limit", "shared-redis.ts"), "utf8"))
      .toMatch(valueImport);
  });
});
