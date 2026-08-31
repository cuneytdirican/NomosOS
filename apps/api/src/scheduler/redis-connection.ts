import { Injectable, Logger } from "@nestjs/common";
import IORedis, { type RedisOptions } from "ioredis";
import { REDIS_PROBE_TIMEOUT_MS } from "./scheduler.constants";

/**
 * REDIS BAĞLANTI ÇÖZÜMÜ VE CANLILIK YOKLAMASI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ TASARIM KARARI: API'nin REDIS'E SERT BAĞIMLILIĞI YOKTUR.                 ║
 * ║                                                                          ║
 * ║ Redis kapalıysa uygulama AÇILIR; yalnız zamanlanmış işler devre dışı     ║
 * ║ kalır. Gerekçe: bu sistemde Redis'in tek işi GECE İŞLERİNİ tetiklemektir.║
 * ║ Duruşma takvimi, süre listesi, dosya açma, belge yükleme — hiçbiri       ║
 * ║ kuyruğa dokunmaz. Redis arızasında bütün bir hukuk bürosunu çalışamaz    ║
 * ║ hâle getirmek, çözdüğünden çok sorun yaratırdı. Buna karşılık sessiz     ║
 * ║ kalmak da kabul edilemez: durum AÇIK BİR UYARI ile loglanır ve           ║
 * ║ `GET /api/admin/v1/jobs` yanıtında `scheduler.mode` alanında görünür.    ║
 * ║                                                                          ║
 * ║ ELLE TETİKLEME BUNDAN ETKİLENMEZ: `POST /jobs/:key/run` süreç içinde     ║
 * ║ çalışır, kuyruğa hiç uğramaz. Yani Redis günlerce kapalı kalsa bile      ║
 * ║ operatör işleri panelden yürütebilir.                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

export interface RedisConfig {
  /** Zamanlayıcı kurulabilir mi? (REDIS_URL tanımlı ve çözülebilir mi) */
  enabled: boolean;
  /** Kapalıysa nedeni — log ve panel için Türkçe açıklama. */
  reason?: string;
  host: string;
  port: number;
  /** BullMQ'ya verilecek bağlantı seçenekleri. */
  options: RedisOptions;
  /** Loglanabilir adres (parola içermez). */
  display: string;
}

/**
 * `REDIS_URL`i çözer. ASLA fırlatmaz — bozuk bir URL uygulamayı düşürmez,
 * yalnız zamanlayıcıyı kapatır.
 */
export function resolveRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfig {
  const raw = env.REDIS_URL?.trim();
  const disabled = (env.SCHEDULER_DISABLED ?? "").toLowerCase() === "true";

  const empty: RedisConfig = {
    enabled: false,
    host: "",
    port: 0,
    options: {},
    display: "-",
  };

  if (disabled) {
    return { ...empty, reason: "SCHEDULER_DISABLED=true — zamanlayıcı açıkça kapatılmış." };
  }
  if (!raw) {
    return {
      ...empty,
      reason:
        "REDIS_URL tanımlı değil. Zamanlanmış işler kurulmadı; kök .env dosyasına " +
        "REDIS_URL=redis://localhost:6379 ekleyin.",
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ...empty, reason: `REDIS_URL çözümlenemedi (geçersiz URL): "${raw}".` };
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    return {
      ...empty,
      reason: `REDIS_URL "redis://" veya "rediss://" ile başlamalıdır (gelen: "${url.protocol}").`,
    };
  }

  const host = url.hostname || "localhost";
  const port = url.port ? Number(url.port) : 6379;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ...empty, reason: `REDIS_URL içindeki port geçersiz: "${url.port}".` };
  }

  const db = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : 0;

  const options: RedisOptions = {
    host,
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isInteger(db) ? db : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    /**
     * BullMQ Worker BLOKLAYAN komutlar (BRPOPLPUSH) kullanır; ioredis'in
     * istek başına yeniden deneme sayacı bu komutlarda zaman aşımına düşer.
     * BullMQ belgeleri bu değeri `null` yapmayı ZORUNLU kılar.
     */
    maxRetriesPerRequest: null,
    /**
     * Bağlantı koptuğunda komutlar bellekte birikmesin: Redis günlerce kapalı
     * kalırsa çevrimdışı kuyruk sessizce büyüyüp süreci şişirirdi.
     */
    enableOfflineQueue: false,
    /** Üstel geri çekilme, 30 sn tavanla — sıkı döngüde log bombardımanı olmaz. */
    retryStrategy: (times: number) => Math.min(times * 500, 30_000),
    connectTimeout: REDIS_PROBE_TIMEOUT_MS,
    lazyConnect: true,
  };

  return {
    enabled: true,
    host,
    port,
    options,
    display: `${host}:${port}${options.db ? `/${options.db}` : ""}`,
  };
}

/**
 * Redis canlılık yoklayıcısı.
 *
 * AYRI BİR SINIF OLMASININ NEDENİ TEST EDİLEBİLİRLİKTİR: `SchedulerService`
 * bu arayüzü enjekte eder; birim testinde "Redis yok" senaryosu, gerçek bir
 * Redis'i kapatmadan, yoklamayı reddeden bir sahte ile kurulur.
 */
export interface RedisProbe {
  /** Başarılıysa gecikmeyi döner; başarısızsa FIRLATIR. */
  ping(config: RedisConfig): Promise<{ latencyMs: number }>;
}

export const REDIS_PROBE = "SCHEDULER_REDIS_PROBE";

@Injectable()
export class IoredisProbe implements RedisProbe {
  private readonly logger = new Logger(IoredisProbe.name);

  async ping(config: RedisConfig): Promise<{ latencyMs: number }> {
    const started = Date.now();
    /**
     * Yoklama BullMQ'nun bağlantılarından AYRI, tek kullanımlık bir bağlantıyla
     * yapılır ve hemen kapatılır. Aynı bağlantıyı paylaşmak, Worker'ın bloklayan
     * komutları yüzünden yoklamanın takılmasına yol açardı.
     */
    const client = new IORedis({
      ...config.options,
      // Yoklama TEK denemedir; burada yeniden denemek "Redis yok" kararını
      // dakikalarca geciktirir ve açılışı bekletirdi.
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    // 'error' dinleyicisi ZORUNLUDUR: dinleyicisiz bir 'error' olayı Node'da
    // yakalanamayan istisnaya dönüşür ve süreci düşürür.
    client.on("error", () => undefined);

    try {
      await withTimeout(client.connect(), REDIS_PROBE_TIMEOUT_MS, "Redis bağlantısı");
      const pong = await withTimeout(client.ping(), REDIS_PROBE_TIMEOUT_MS, "Redis PING");
      if (pong !== "PONG") {
        throw new Error(`Beklenmeyen PING yanıtı: ${String(pong)}`);
      }
      return { latencyMs: Date.now() - started };
    } finally {
      try {
        client.disconnect();
      } catch (err) {
        this.logger.debug(`Yoklama bağlantısı kapatılamadı: ${(err as Error).message}`);
      }
    }
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} zaman aşımına uğradı (${ms} ms).`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
