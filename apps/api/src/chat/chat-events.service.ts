/**
 * SSE OLAY VERİYOLU (geliştirme planı D3 / C4; D5 ölçek kapanışı) — gerçek
 * zamanlı mesajlaşma sinyali.
 *
 * TASARIM: bellek-içi yayın + İSTEMCİ YENİDEN ÇEKME modeli. Olay yalnızca
 * "bir şey değişti" SİNYALİDİR (hafif, kişisel veri taşMAZ); istemci sinyali
 * alınca mevcut listeleme uçlarından YENİDEN çeker. Avantaj:
 *   - olay kaybedilirse (bağlantı koparsa) polling yedeği zaten çalışır —
 *     veri kaybı yok;
 *   - olay içeriğinde kişisel veri DOLAŞMAZ (KVKK yüzeyi genişlemez);
 *   - mevcut uç sözleşmeleri DEĞİŞMEZ.
 *
 * ÇOKLU ÖRNEK (D5): REDIS_URL tanımlıysa olaylar Redis pub/sub üzerinden
 * örneklere de yayınlanır (yayıncı + abone ayrı bağlantılar). YANKI ÖNLEME:
 * zarftaki `origin` bu örneğin kimliğiyse yerel dağıtım ATLANIR — yayıncı
 * kendi olayını zaten yerel dağıttı.
 *
 * ZARİF BOZULMA (zamanlayıcıyla aynı felsefe): Redis'e SERT bağımlılık YOK.
 * REDIS_URL yoksa, çözülemezse ya da bağlantı düşerse veriyolu YEREL kipte
 * çalışmaya devam eder (tek örnek davranışı); durum BİR KEZ uyarıyla loglanır
 * ve `mode` alanından görünür. Mesaj gönderimi Redis yüzünden ASLA başarısız
 * olmaz — yayın ateşle-unut modundadır.
 */

import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import { resolveRedisConfig } from "../scheduler/redis-connection";

/** İstemciye giden sinyal biçimi — kişiye özgü veri YOKTUR. */
export interface ChatEvent {
  type: "chat.message" | "chat.read" | "chat.call";
  /** Tetikleyen kullanıcı — istemci kendi eylemini ayırt eder. */
  by: string;
  /** İlgili taraf (mesajın alıcısı) — ucu görür. */
  to?: string;
  at: number;
}

/** Redis zarfı — yerel dağıtımı yankı önlemeyle denetler. */
interface ChatEventEnvelope {
  origin: string;
  tenantId: string;
  event: ChatEvent;
}

/** Olay kanalı — kiracıya özgü veri YOK, yalnızca sinyal. */
export const CHAT_EVENTS_CHANNEL = "nomosos:chat-events";

export function buildChatEventEnvelope(origin: string, tenantId: string, event: ChatEvent): string {
  return JSON.stringify({ origin, tenantId, event } satisfies ChatEventEnvelope);
}

/** Bozuk/portun zarfı null döner — abone akışı bir bozuk mesajla düşmez. */
export function parseChatEventEnvelope(raw: string): ChatEventEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ChatEventEnvelope>;
    if (
      typeof parsed.origin !== "string" ||
      typeof parsed.tenantId !== "string" ||
      !parsed.event ||
      typeof parsed.event !== "object"
    ) {
      return null;
    }
    return parsed as ChatEventEnvelope;
  } catch {
    return null;
  }
}

type Listener = (event: ChatEvent) => void;

export type ChatEventsMode = "redis" | "local";

@Injectable()
export class ChatEventsService implements OnApplicationShutdown {
  private readonly logger = new Logger(ChatEventsService.name);
  /** Bu örneğin kimliği — yankı önlemede kullanılır. */
  private readonly instanceId = randomUUID();

  /** tenantId → dinleyiciler. */
  private readonly subs = new Map<string, Set<Listener>>();

  /** Yayıncı bağlantısı — yoksa yerel kip. */
  private publisher: IORedis | null = null;
  private mode: ChatEventsMode = "local";

  /**
   * REDIS_URL tanımlıysa pub/sub köprüsünü kurar. BAŞARISIZLIK KAPALI DEĞİLDİR:
   * kurulum/abonelik hatası yerel kipte devam eder (tek örnek davranışı),
   * yalnızca bir uyarı loglanır.
   */
  onApplicationBootstrap(): void {
    const config = resolveRedisConfig();
    if (!config.enabled) {
      this.logger.log(`SSE veriyolu YEREL kipte (${config.reason ?? "REDIS_URL yok"}) — tek örnek sınırlı.`);
      return;
    }
    try {
      // Abone ve yayıncı AYRI bağlantılar: Redis'te abone olmuş bir bağlantı
      // komut gönderemez (RESP2). Bağlantı kopuşunda ioredis aboneliği
      // kendiliğinden yeniler.
      const subscriber = new IORedis(config.options);
      this.publisher = new IORedis(config.options);

      subscriber.on("message", (_channel: string, raw: string) => {
        const envelope = parseChatEventEnvelope(raw);
        if (!envelope) {
          this.logger.warn("Bozuk SSE olay zarfı alındı; mesaj yok sayıldı.");
          return;
        }
        // Yankı önleme: kendi yayınımız yerel dağıtılmıştı.
        if (envelope.origin === this.instanceId) return;
        this.dispatchLocal(envelope.tenantId, envelope.event);
      });
      // 'error' dinleyicisi ZORUNLU: dinleyicisiz 'error' süreci düşürür.
      // Bağlantı HATASI bozulma DEĞİLDİR: ioredis otomatik yeniden bağlanır ve
      // aboneliği yeniden kurar — veriyolu kipi değişmez, yalnız bir kez loglanır.
      subscriber.on("error", () => this.warnOnce("subscriber", "Redis abone bağlantısı hatası; otomatik yeniden bağlanma beklenecek."));
      this.publisher.on("error", () => this.warnOnce("publisher", "Redis yayıncı bağlantısı hatası; otomatik yeniden bağlanma beklenecek."));

      // Yayıncı da lazyConnect ile kurulur; ilk yayını beklemeden AÇIKÇA
      // bağlanır (bağlı değilken publish çevrimdışı kuyruğu olmadığından hata verir).
      this.publisher.connect().catch(() => undefined);

      // resolveRedisConfig lazyConnect: true verir; abonelik kurmak için
      // bağlantıyı AÇIKÇA kurmak gerekir (enableOfflineQueue: false iken
      // bağlı olmayan bağlantıya SUBSCRIBE yazılamaz).
      void (async () => {
        try {
          await subscriber.connect();
          await subscriber.subscribe(CHAT_EVENTS_CHANNEL);
          this.mode = "redis";
          this.logger.log(`SSE veriyolu Redis pub/sub kipinde (${config.display}) — çoklu örnek desteklenir.`);
        } catch (err) {
          subscriber.disconnect();
          this.publisher?.disconnect();
          this.publisher = null;
          this.mode = "local";
          this.logger.warn(
            `SSE veriyolu YEREL kipte açıldı (Redis aboneliği kurulamadı: ${(err as Error).message}). ` +
              "Tek örnek davranışı sürer; Redis düzeldiğinde yeniden başlatın."
          );
        }
      })();
    } catch (err) {
      this.mode = "local";
      this.logger.warn(
        `SSE veriyolu YEREL kipte açıldı (köprü kurulamadı: ${(err as Error).message}). ` +
          "Tek örnek davranışı sürer; REDIS_URL'yi denetleyin."
      );
    }
  }

  onApplicationShutdown(): void {
    this.publisher?.disconnect();
    this.publisher = null;
  }

  /** Yalnızca YEREL dağıtım — Redis'ten gelen mesajlar ve hızlı yol. */
  private dispatchLocal(tenantId: string, event: ChatEvent): void {
    const listeners = this.subs.get(tenantId);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        /* tek dinleyicinin hatası yayın zincirini düşürmez */
      }
    }
  }

  /** Kiracıya olay yayınlar; dinleyici yoksa hiçbir şey yapmaz. */
  publish(tenantId: string, event: ChatEvent): void {
    // 1) Hızlı yol: bu örnekteki dinleyiciler.
    this.dispatchLocal(tenantId, event);
    // 2) Çoklu örnek: diğer örneklere ateşle-unut. Yayın hatası mesaj
    //    GÖNDERİMİNİ değil, yalnızca ÇAPRAZ ÖRNEK sinyalini etkiler;
    //    ioredis bağlantıyı kendisi yeniler, yayın otomatik sürer.
    if (this.mode === "redis" && this.publisher) {
      try {
        this.publisher
          .publish(CHAT_EVENTS_CHANNEL, buildChatEventEnvelope(this.instanceId, tenantId, event))
          .catch(() => this.warnOnce("publish", "Redis yayını başarısız (çevrimdışı olabilir); yerel dağıtım sürdü."));
      } catch {
        this.warnOnce("publish-sync", "Redis yayını sırasında hata; yerel dağıtım sürdü.");
      }
    }
  }

  /**
   * Dinleyici kaydeder; kayıt geri alma işlevi döner (bağlantı kapanınca
   * çağrılır — aksi hâlde harita sonsuza dek büyür).
   */
  subscribe(tenantId: string, listener: Listener): () => void {
    let set = this.subs.get(tenantId);
    if (!set) {
      set = new Set();
      this.subs.set(tenantId, set);
    }
    set.add(listener);
    return () => {
      const current = this.subs.get(tenantId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.subs.delete(tenantId);
    };
  }

  /** Toplam açık bağlantı sayısı (izleme/test için). */
  get connectionCount(): number {
    let total = 0;
    for (const set of this.subs.values()) total += set.size;
    return total;
  }

  /** Veriyolu kipi — /metrics ve paneller için. */
  get busMode(): ChatEventsMode {
    return this.mode;
  }

  /** Anahtar başına BİR KEZ uyarı — bağlantı kopuşlarında log bombardımanı olmaz. */
  private warned = new Set<string>();
  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(message);
  }
}
