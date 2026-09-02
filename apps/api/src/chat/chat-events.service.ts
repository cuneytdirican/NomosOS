/**
 * SSE OLAY VERİYOLU (geliştirme planı D3 / C4) — gerçek zamanlı mesajlaşma.
 *
 * TASARIM (bilinçli): bellek-içi yayın + İSTEMCİ YENİDEN ÇEKME modeli.
 * Olay yalnızca "bir şey değişti" SİNYALİDİR (hafif, kişisel veri taşMAZ);
 * istemci sinyali alınca mevcut listeleme uçlarından YENİDEN çeker. Avantaj:
 *   - olay kaybedilirse (bağlantı koparsa) polling yedeği zaten çalışır —
 *     veri kaybı yok;
 *   - olay içeriğinde kişisel veri DOLAŞMAZ (KVKK yüzeyi genişlemez);
 *   - mevcut uç sözleşmeleri DEĞİŞMEZ.
 *
 * KAPSAM: tek örnek (replicas=1) varsayarımı — çoklu örnekte Redis
 * pub/sub gerekir; bu bilinçli sınırdır ve plan dosyasında not edilmiştir.
 */

import { Injectable } from "@nestjs/common";

/** İstemciye giden sinyal biçimi — kişiye özgü veri YOKTUR. */
export interface ChatEvent {
  type: "chat.message" | "chat.read" | "chat.call";
  /** Tetikleyen kullanıcı — istemci kendi eylemini ayırt eder. */
  by: string;
  /** İlgili taraf (mesajın alıcısı) — ucu görür. */
  to?: string;
  at: number;
}

type Listener = (event: ChatEvent) => void;

@Injectable()
export class ChatEventsService {
  /** tenantId → dinleyiciler. */
  private readonly subs = new Map<string, Set<Listener>>();

  /** Kiracıya olay yayınlar; dinleyici yoksa hiçbir şey yapmaz. */
  publish(tenantId: string, event: ChatEvent): void {
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
}
