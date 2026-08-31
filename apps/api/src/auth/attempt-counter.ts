import { Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { sharedRateLimitRedis } from "../common/rate-limit/shared-redis";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ORTAK DENEME SAYACI — denetim bulgusu Ö-09                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Kimlik güvenliğinin BEŞ sayacı süreç belleğindeydi (giriş hız sınırı, panel
 * 2FA challenge sınırı, portal dar sayacı, portal uç hız sınırı, AI hız
 * sınırı). Her biri yorumunda "Faz 2/3'te Redis'e taşınmalı" diyordu; Redis
 * ayakta, BullMQ onu kullanıyor, hiçbiri taşınmamıştı.
 *
 * Sonucu ARİTMETİKTİR: `deploy.replicas = 3` yapıldığında panel 2FA sınırı
 * 3'ten 9'a, portal giriş sınırı 5'ten 15'e çıkar ve hiçbir uyarı çıkmaz.
 * Bu, `app.module.ts`'te yazılı mimariyle de çelişiyordu: ekip orada
 * `@nestjs/schedule`'ı "süreç-içi zamanlayıcıdır, her örnekte bir kez tetikler"
 * diye bilinçli reddetmiş, aynı akıl yürütmeyi hız sınırına uygulamamıştı.
 *
 * TASARIM
 * -------
 * • Sayaç REDIS'tedir: `INCR` + ilk vuruşta `PEXPIRE`. Bütün örnekler aynı
 *   kovaya yazar, sınır replika sayısıyla çarpılmaz.
 * • REDIS YOKSA API YİNE AÇILIR. `REDIS_URL` tanımsızsa süreç-içi kovaya
 *   düşülür ve açılışta BİR KEZ belirgin uyarı basılır — sessizce zayıflamak
 *   yasaktır, ama geliştirme ortamını Redis'e mecbur etmek de doğru değildir.
 * • Redis çalışırken hata verirse istek REDDEDİLMEZ: o çağrı için bellek
 *   kovasına düşülür. Hız sınırının arızası, girişin tamamen kapanmasından
 *   daha iyi bir başarısızlık biçimidir (hesap düzeyindeki KALICI kilit
 *   veritabanındadır ve bu arızadan etkilenmez).
 * • KALICI olması gereken sayaç (hesap kilidi) ZATEN VERİTABANINDADIR:
 *   `PlatformUser.failedAttempts/lockedUntil` ve `PortalUser.failedAttempts/
 *   failureWindowEndsAt/lockedUntil`. Buradaki kovalar onların ÜSTÜNE konan
 *   pencere sayaçlarıdır; süreç yeniden başlasa da hesap kilidi düşmez.
 */

export interface CounterHit {
  /** Pencere içindeki toplam vuruş (bu vuruş dâhil). */
  count: number;
  /** Pencerenin bittiği an (ms epoch). */
  resetAt: number;
}

export interface AttemptCounterBackend {
  hit(key: string, windowMs: number, now?: number): Promise<CounterHit>;
  /** Sayacı ARTIRMADAN okur; pencere yoksa `null`. */
  peek(key: string, now?: number): Promise<CounterHit | null>;
  /**
   * Var olan pencerenin süresini uzatır (kilit kurmak için).
   * Sayaç DEĞİŞMEZ — yalnız pencere sonu ileri alınır.
   */
  extend(key: string, windowMs: number, now?: number): Promise<void>;
  reset(key: string): Promise<void>;
}

/** Sayaç tablosunun sınırsız büyümesini önleyen üst sınır. */
const MAX_TRACKED_KEYS = 20_000;

/**
 * SÜREÇ-İÇİ KOVA — yalnızca Redis yokken veya Redis arızalıyken.
 * Saf ve testlenebilir: saat dışarıdan verilebilir.
 */
export class MemoryAttemptCounter implements AttemptCounterBackend {
  private readonly buckets = new Map<string, CounterHit>();

  async hit(key: string, windowMs: number, now: number = Date.now()): Promise<CounterHit> {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      this.prune(now);
      return { ...fresh };
    }
    bucket.count += 1;
    return { ...bucket };
  }

  async peek(key: string, now: number = Date.now()): Promise<CounterHit | null> {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) return null;
    return { ...bucket };
  }

  async extend(key: string, windowMs: number, now: number = Date.now()): Promise<void> {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    bucket.resetAt = now + windowMs;
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  private prune(now: number): void {
    if (this.buckets.size < MAX_TRACKED_KEYS) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/** Redis kovası — tüm API örnekleri arasında PAYLAŞILIR. */
export class RedisAttemptCounter implements AttemptCounterBackend {
  private readonly logger = new Logger(RedisAttemptCounter.name);

  constructor(
    private readonly redis: Redis,
    /** Redis arızasında düşülecek kova. */
    private readonly fallback: AttemptCounterBackend
  ) {}

  async hit(key: string, windowMs: number, now: number = Date.now()): Promise<CounterHit> {
    const redisKey = `nomosos:attempt:${key}`;
    try {
      const count = await this.redis.incr(redisKey);
      if (count === 1) {
        await this.redis.pexpire(redisKey, windowMs);
        return { count, resetAt: now + windowMs };
      }
      const ttl = await this.redis.pttl(redisKey);
      // -1: süre yok (yarış hâli) → pencereyi yeniden kur, sayaç kaybolmasın.
      if (ttl < 0) {
        await this.redis.pexpire(redisKey, windowMs);
        return { count, resetAt: now + windowMs };
      }
      return { count, resetAt: now + ttl };
    } catch (err) {
      this.logger.warn(
        `Redis deneme sayacı okunamadı, bu çağrı için süreç-içi kovaya düşüldü: ${
          (err as Error).message
        }`
      );
      return this.fallback.hit(key, windowMs, now);
    }
  }

  async peek(key: string, now: number = Date.now()): Promise<CounterHit | null> {
    try {
      const raw = await this.redis.get(`nomosos:attempt:${key}`);
      if (raw === null) return null;
      const ttl = await this.redis.pttl(`nomosos:attempt:${key}`);
      return { count: Number(raw), resetAt: now + Math.max(ttl, 0) };
    } catch {
      return this.fallback.peek(key, now);
    }
  }

  async extend(key: string, windowMs: number, now: number = Date.now()): Promise<void> {
    try {
      await this.redis.pexpire(`nomosos:attempt:${key}`, windowMs);
    } catch {
      await this.fallback.extend(key, windowMs, now);
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.redis.del(`nomosos:attempt:${key}`);
    } catch {
      // Sıfırlama başarısızlığı yalnızca meşru kullanıcıyı pencere sonuna kadar
      // bekletir; güvenlik açığı doğurmaz.
    }
    await this.fallback.reset(key);
  }
}

let singleton: AttemptCounterBackend | null = null;

/**
 * Süreç genelinde TEK sayaç örneği.
 *
 * Nest DI yerine modül düzeyi tekil kullanılır: sayacı kullanan beş yer üç
 * ayrı modülde yaşıyor (auth, platform, portal) ve hiçbiri diğerini import
 * etmiyor; DI'ya bağlamak `app.module.ts`'e (başka bir ajanın alanı)
 * dokunmayı gerektirirdi.
 */
export function attemptCounter(): AttemptCounterBackend {
  if (singleton) return singleton;

  const memory = new MemoryAttemptCounter();
  // ENTEGRASYON (Ö-09): bağlantı artık burada AÇILMAZ. AI oran sınırı sayacı
  // (`common/rate-limit/counter-store.ts`) ile AYNI TCP bağlantısı paylaşılır;
  // iki sayaç ayrı ayrı `new IORedis(...)` diyerek replika başına iki bağlantı
  // açıyordu ve istek-yolu ayarlarını kopyalıyordu (bkz. `shared-redis.ts`).
  const { client, reason } = sharedRateLimitRedis(process.env);
  if (!client) {
    new Logger("AttemptCounter").warn(
      "Paylaşılan Redis bağlantısı yok; kimlik deneme sayaçları SÜREÇ BELLEĞİNDE " +
        "tutuluyor. Tek örnekli kurulumda koruma tamdır; ÇOK ÖRNEKLİ kurulumda " +
        `giriş ve 2FA sınırları örnek sayısıyla ÇARPILIR. Gerekçe: ${reason ?? "-"}`
    );
    singleton = memory;
    return singleton;
  }

  singleton = new RedisAttemptCounter(client, memory);
  return singleton;
}

/** Testler için: tekil örneği sıfırlar. */
export function resetAttemptCounterForTests(backend: AttemptCounterBackend | null = null): void {
  singleton = backend;
}
