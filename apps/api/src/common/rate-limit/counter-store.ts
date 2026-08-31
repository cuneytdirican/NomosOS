/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ORTAK ORAN SINIRI SAYACI — denetim bulgusu Ö-09                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * SORUN: Depoda BEŞ ayrı süreç-içi sayaç vardı (`login-throttle.guard.ts`,
 * `platform-auth.service.ts` 2FA challenge, `portal-lockout.ts`,
 * `portal-rate-limit.guard.ts`, `ai-rate-limit.guard.ts`) ve her biri
 * yorumunda "Faz 2/3'te Redis'e taşınmalı" diyordu. Hiçbiri taşınmamıştı.
 * `deploy.replicas: 3` yapıldığında panel 2FA sınırı 3'ten 9'a, portal giriş
 * sınırı 5'ten 15'e, AI günlük tavanı 300'den 900'e çıkar ve HİÇBİR UYARI
 * ÇIKMAZ. Bu, `app.module.ts`in `@nestjs/schedule`ı reddederken yazdığı
 * gerekçenin ("süreç-içi zamanlayıcı her örnekte bir kez tetiklenir") aynısıdır
 * — akıl yürütme oran sınırına uygulanmamıştı.
 *
 * BU DOSYA ORTAK ARAYÜZDÜR. Beş sayacın hepsi buraya taşınabilsin diye
 * kasıtlı olarak KÜÇÜK tutuldu: sabit pencere (fixed window) sayacı, tek bir
 * anahtar, tek bir maliyet. Kilit, kayan pencere, jeton kovası YOKTUR —
 * sayacın karmaşıklaşması, farklı yüzeylerin onu kopyalamasına yol açar.
 *
 * ┌─ ARAYÜZ SÖZLEŞMESİ ────────────────────────────────────────────────────┐
 * │ increment(key, windowMs, cost) → { count, resetAt }                     │
 * │   Anahtarı `cost` kadar artırır ve ARTIRIMDAN SONRAKİ sayacı döner.     │
 * │   Anahtar yoksa pencere o an başlar ve `windowMs` sonra sıfırlanır.     │
 * │ decrement(key, cost)                                                    │
 * │   Geri alma. Bir istek BİRDEN ÇOK kovaya yazar (kullanıcı+büro,         │
 * │   dakika+gün); ikinci kova reddedilirse birincinin artışı GERİ ALINIR,  │
 * │   yoksa reddedilen istek de kotadan yerdi.                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * A AJANINA NOT (kimlik yüzeyi): `LoginThrottleGuard`, `PortalLockoutStore`,
 * `PortalRateLimitGuard` ve panel 2FA sayacı bu arayüzü OLDUĞU GİBİ
 * kullanabilir; `getCounterStore()` süreç genelinde tek örnek döner ve
 * REDIS_URL tanımlıysa kendiliğinden Redis'e geçer. Kalıcı hesap kilidi
 * (`User.lockedUntil`) bu sayacın konusu DEĞİLDİR — o veritabanındadır ve
 * öyle kalmalıdır; buradaki sayaç yalnız KISA PENCERELİ hız sınırıdır.
 */

import type IORedis from "ioredis";
import { Logger } from "@nestjs/common";
import { sharedRateLimitRedis } from "./shared-redis";

export interface RateLimitWindow {
  /** Artırımdan SONRAKİ sayaç değeri. */
  count: number;
  /** Pencerenin sıfırlanacağı an (epoch ms). */
  resetAt: number;
}

export interface RateLimitCounterStore {
  /** Günlüğe ve panele basılabilecek arka uç adı. */
  readonly kind: "surec-ici" | "redis";
  increment(key: string, windowMs: number, cost: number): Promise<RateLimitWindow>;
  decrement(key: string, cost: number): Promise<void>;
  /** Testler ve elle sıfırlama. */
  reset(): Promise<void>;
}

const KEY_PREFIX = "nomosos:rl:";

// ===========================================================================
// 1) SÜREÇ-İÇİ SAYAÇ — tek örnekli kurulum ve birim testleri için
// ===========================================================================

interface MemoryBucket {
  windowStart: number;
  windowMs: number;
  count: number;
}

/**
 * Tek süreçte doğru, çok süreçte ÖRNEK SAYISIYLA ÇARPILAN sayaç.
 * Redis yoksa davranış eskisiyle birebir aynıdır — bu bilinçlidir: Redis
 * arızası bütün AI uçlarını kapatmamalıdır (bkz. `redis-connection.ts`teki
 * "API'nin Redis'e sert bağımlılığı yoktur" kararı).
 */
export class InProcessCounterStore implements RateLimitCounterStore {
  readonly kind = "surec-ici" as const;
  private readonly buckets = new Map<string, MemoryBucket>();
  private lastSweep = Date.now();

  async increment(key: string, windowMs: number, cost: number): Promise<RateLimitWindow> {
    const now = Date.now();
    this.sweep(now);

    const existing = this.buckets.get(key);
    const bucket: MemoryBucket =
      existing && now - existing.windowStart < existing.windowMs
        ? existing
        : { windowStart: now, windowMs, count: 0 };

    bucket.count += cost;
    bucket.windowMs = windowMs;
    this.buckets.set(key, bucket);
    return { count: bucket.count, resetAt: bucket.windowStart + windowMs };
  }

  async decrement(key: string, cost: number): Promise<void> {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    // GREATEST(0, …) deseni: sayaç hiçbir hata dalında negatife düşemez.
    bucket.count = Math.max(0, bucket.count - cost);
  }

  async reset(): Promise<void> {
    this.buckets.clear();
  }

  /** Bellekte sonsuza dek anahtar biriktirmemek için saatte bir budama. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60 * 60 * 1000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= bucket.windowMs) this.buckets.delete(key);
    }
  }
}

// ===========================================================================
// 2) REDIS SAYACI — çok örnekli kurulumda TEK gerçek sayaç
// ===========================================================================

/**
 * `INCRBY` + `PEXPIRE` ile sabit pencere.
 *
 * NEDEN `INCRBY` (oku-topla-yaz DEĞİL): artırım Redis tarafında ATOMİKTİR;
 * üç API örneği aynı anda artırsa da sayaç bir kez artar. "Önce GET sonra SET"
 * deseni tam olarak Ö-09'un çözmeye çalıştığı yarışı geri getirirdi.
 *
 * PENCERE İLK ARTIRIMDA KURULUR: `PTTL` -1 dönerse (anahtar var, süresi yok)
 * `PEXPIRE` yazılır. Bu, süresi hiç kurulamamış bir anahtarın sonsuza dek
 * kalıp kullanıcıyı kalıcı olarak kilitlemesini engeller.
 *
 * ARIZA DAVRANIŞI — SESSİZ DEĞİL, DÜŞÜREREK DEVAM: Redis'e ulaşılamazsa
 * istek REDDEDİLMEZ; sayaç süreç-içi yedeğe düşer ve durum bir kez uyarı
 * olarak loglanır. Alternatif (Redis yokken tüm AI uçlarını 429'lamak)
 * hukuk bürosunu Redis arızasında çalışamaz hâle getirirdi.
 */
export class RedisCounterStore implements RateLimitCounterStore {
  readonly kind = "redis" as const;
  private readonly logger = new Logger(RedisCounterStore.name);
  private readonly fallback = new InProcessCounterStore();
  private degradedSince: number | null = null;

  constructor(
    private readonly client: Pick<IORedis, "incrby" | "pttl" | "pexpire" | "flushdb">,
    /** Arıza sonrası Redis'i yeniden denemeden önce beklenecek süre. */
    private readonly retryAfterMs = 30_000,
  ) {}

  private get degraded(): boolean {
    if (this.degradedSince === null) return false;
    if (Date.now() - this.degradedSince >= this.retryAfterMs) {
      this.degradedSince = null;
      this.logger.log("Redis oran sınırı sayacı yeniden denenecek.");
      return false;
    }
    return true;
  }

  private degrade(err: unknown): void {
    if (this.degradedSince === null) {
      this.logger.warn(
        `Redis oran sınırı sayacına ulaşılamadı, süreç-içi yedeğe düşüldü: ${(err as Error).message}. ` +
          "ÇOK ÖRNEKLİ kurulumda sınırlar bu süre boyunca örnek sayısıyla çarpılır (Ö-09).",
      );
    }
    this.degradedSince = Date.now();
  }

  async increment(key: string, windowMs: number, cost: number): Promise<RateLimitWindow> {
    if (this.degraded) return this.fallback.increment(key, windowMs, cost);
    const full = KEY_PREFIX + key;
    try {
      const count = await this.client.incrby(full, cost);
      let ttl = await this.client.pttl(full);
      if (ttl < 0) {
        await this.client.pexpire(full, windowMs);
        ttl = windowMs;
      }
      return { count, resetAt: Date.now() + ttl };
    } catch (err) {
      this.degrade(err);
      return this.fallback.increment(key, windowMs, cost);
    }
  }

  async decrement(key: string, cost: number): Promise<void> {
    if (this.degraded) return this.fallback.decrement(key, cost);
    try {
      await this.client.incrby(KEY_PREFIX + key, -cost);
    } catch (err) {
      this.degrade(err);
      await this.fallback.decrement(key, cost);
    }
  }

  async reset(): Promise<void> {
    await this.fallback.reset();
    try {
      await this.client.flushdb();
    } catch (err) {
      this.logger.debug(`Redis sayacı sıfırlanamadı: ${(err as Error).message}`);
    }
  }
}

// ===========================================================================
// 3) SÜREÇ GENELİ ÇÖZÜMLEYİCİ
// ===========================================================================

let singleton: RateLimitCounterStore | null = null;

/**
 * NEDEN NEST DI DEĞİL: `AiRateLimitGuard` uçlara `@UseGuards(AiRateLimitGuard)`
 * ile takılır ve Nest onu HER modül bağlamında ayrı çözer. Sayacı DI ile
 * dağıtmak, bütün modüllere (ve `app.module.ts`e) dokunmayı gerektirirdi;
 * oysa sayaç süreç genelinde TEK olmalıdır. Bu yüzden çözümleme süreç
 * düzeyindedir ve testlerde `setCounterStore()` ile değiştirilir.
 *
 * `RATE_LIMIT_BACKEND` = auto (varsayılan) | memory | redis
 *   auto   → REDIS_URL varsa Redis, yoksa süreç-içi
 *   memory → her koşulda süreç-içi (tek örnekli kurulum, testler)
 *   redis  → REDIS_URL zorunlu; yoksa AÇILIŞTA HATA (sessizce düşmez)
 */
export function getCounterStore(env: NodeJS.ProcessEnv = process.env): RateLimitCounterStore {
  if (singleton) return singleton;

  // ENTEGRASYON (Ö-09): bağlantı artık burada AÇILMAZ. `attempt-counter.ts`
  // ile aynı TCP bağlantısı paylaşılır; iki sayaç iki bağlantı açıyordu.
  // Ayrıştırma, `RATE_LIMIT_BACKEND` yorumu ve arıza kararı `shared-redis.ts`te.
  const { client } = sharedRateLimitRedis(env);
  singleton = client ? new RedisCounterStore(client) : new InProcessCounterStore();
  return singleton;
}

/** Testler için: sayacı değiştirir. `null` verilirse bir sonraki çağrı yeniden çözer. */
export function setCounterStore(store: RateLimitCounterStore | null): void {
  singleton = store;
}
