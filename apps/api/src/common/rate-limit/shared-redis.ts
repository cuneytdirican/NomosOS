import { Logger } from "@nestjs/common";
import IORedis, { type Redis } from "ioredis";
import { resolveRedisConfig } from "../../scheduler/redis-connection";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ İSTEK YOLUNDAKİ TEK REDIS BAĞLANTISI — Ö-09 entegrasyonu                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Ö-09 iki ajan tarafından paralel çözüldü ve İKİ AYRI sayaç doğdu:
 *   • `auth/attempt-counter.ts`      → `AttemptCounterBackend`  (kimlik yüzeyi)
 *   • `common/rate-limit/counter-store.ts` → `RateLimitCounterStore` (AI yüzeyi)
 *
 * Arayüzleri BİLEREK birleştirilmedi: semantikleri gerçekten farklıdır.
 * Kimlik yüzeyi `peek` (artırmadan okuma) ve `extend` (pencereyi uzatarak
 * kilit kurma) ister; AI yüzeyi `decrement` (reddedilen isteğin maliyetini
 * geri verme) ve maliyetli artırım ister. Tek arayüzde toplamak, ya beş
 * metotlu bir "her şeyi yapan" sayaç ya da her iki tarafta ölü kod üretirdi.
 *
 * BİRLEŞTİRİLEN ŞEY BAĞLANTIDIR. İki dosya `new IORedis(...)` diyerek AYRI
 * TCP bağlantısı açıyordu: iki kez el sıkışma, iki kez yeniden bağlanma
 * fırtınası, iki ayrı `error` dinleyicisi ve — Redis `maxclients` sınırına
 * yakın çalışan bir kurulumda — replika başına iki kat bağlantı. Sayaç
 * yolunun bağlantı ayarları da (kısa zaman aşımı, çevrimdışı kuyruk kapalı)
 * her iki yerde birebir aynı olmalıydı; kopyalanmış olduğu için ayrışmaya
 * açıktı. Artık tek yerde durur.
 *
 * ZAMANLAYICI BAĞLANTISINDAN NEDEN AYRI: BullMQ bağlantısı `maxRetriesPerRequest:
 * null` ve bloklayan komutlarla çalışır — istek yolunda böyle bir bağlantı,
 * Redis yavaşladığında HTTP isteğini süresiz bekletir. Burası tam tersini
 * ister: hızlı başarısız ol, süreç-içi kovaya düş, isteği reddetme.
 */

/** `RATE_LIMIT_BACKEND` değerinin ayrıştırılmış hâli. */
export type RateLimitBackendChoice = "auto" | "memory" | "redis";

export interface SharedRedisResolution {
  /** Kullanılabilir istemci; `null` ise süreç-içi kovaya düşülmelidir. */
  client: Redis | null;
  /** `client` null ise Türkçe gerekçe (log için). */
  reason?: string;
}

/**
 * `RATE_LIMIT_BACKEND` = auto (varsayılan) | memory | redis
 *   auto   → REDIS_URL çözülüyorsa Redis, yoksa süreç-içi
 *   memory → her koşulda süreç-içi (tek örnekli kurulum, testler)
 *   redis  → REDIS_URL zorunlu; yoksa AÇILIŞTA HATA (sessizce düşmez)
 */
export function readBackendChoice(env: NodeJS.ProcessEnv): RateLimitBackendChoice {
  const raw = (env.RATE_LIMIT_BACKEND ?? "auto").trim().toLowerCase();
  if (raw === "memory" || raw === "redis") return raw;
  return "auto";
}

let shared: SharedRedisResolution | null = null;

/**
 * Süreç genelinde TEK istek-yolu Redis bağlantısı. Hem `attemptCounter()` hem
 * `getCounterStore()` buradan alır.
 */
export function sharedRateLimitRedis(
  env: NodeJS.ProcessEnv = process.env
): SharedRedisResolution {
  if (shared) return shared;

  const backend = readBackendChoice(env);
  if (backend === "memory") {
    shared = { client: null, reason: "RATE_LIMIT_BACKEND=memory — süreç-içi kova istendi." };
    return shared;
  }

  /**
   * `SCHEDULER_DISABLED` BURADA GEÇERSİZDİR ve bilinçli olarak bastırılır.
   * `resolveRedisConfig` o bayrağı görünce `enabled:false` döner; bu, GECE
   * İŞLERİ için doğru bir karardır. Oran sınırı sayacı ise zamanlayıcıdan
   * bağımsızdır: "işleri kapat" demek "güvenlik sayaçlarını replika sayısıyla
   * çarp" demek olmamalıdır. URL ayrıştırma (auth, db, tls) tek yerde kalsın
   * diye aynı fonksiyon yeniden kullanılır, yalnız bu tek bayrak susturulur.
   */
  const config = resolveRedisConfig({ ...env, SCHEDULER_DISABLED: "false" });

  if (!config.enabled) {
    if (backend === "redis") {
      throw new Error(
        "RATE_LIMIT_BACKEND=redis ayarlandı ama Redis bağlantısı çözülemedi. Oran " +
          "sınırı sayacı sessizce süreç-içine düşürülmez (Ö-09): ya geçerli bir " +
          `REDIS_URL verin ya RATE_LIMIT_BACKEND=memory yazın. Gerekçe: ${config.reason ?? "-"}`
      );
    }
    shared = { client: null, reason: config.reason };
    return shared;
  }

  const client = new IORedis({
    ...config.options,
    // İSTEK YOLU AYARLARI — zamanlayıcı bağlantısının tersi.
    // Bekleyen bir Redis, HTTP isteğini bekletmemeli; hata dönsün ve
    // çağıran süreç-içi kovaya düşsün.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 1000,
    lazyConnect: true,
    retryStrategy: (times: number) => Math.min(times * 500, 30_000),
  });
  // 'error' dinleyicisi ZORUNLUDUR: dinleyicisiz 'error' olayı Node'da
  // yakalanamayan istisnaya dönüşür ve süreci düşürür.
  client.on("error", () => undefined);

  new Logger("RateLimitRedis").log(
    `Oran sınırı ve deneme sayaçları Redis'te paylaşılıyor (${config.display}).`
  );

  shared = { client };
  return shared;
}

/** Testler için: paylaşılan bağlantıyı unutturur. */
export function resetSharedRateLimitRedisForTests(): void {
  shared = null;
}
