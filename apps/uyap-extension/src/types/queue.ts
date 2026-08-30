/** Aktarım kuyruğu tipleri — kuyruk `chrome.storage.local` içinde kalıcıdır. */

export type QueueItemKind = "SYNC_FILES" | "SYNC_EVENTS" | "DOCUMENT";

export type QueueItemStatus =
  /** Sırada, gönderilmeyi bekliyor. */
  | "PENDING"
  /** Gönderim sürüyor (service worker yeniden başlarsa PENDING'e döner). */
  | "INFLIGHT"
  /** Başarıyla gönderildi. */
  | "DONE"
  /** Sunucu "bu içerik zaten var" dedi ya da yerel defterde hash mevcuttu. */
  | "DUPLICATE"
  /** Yeniden deneme hakkı bitti; kullanıcı popup'tan elle tekrarlayabilir. */
  | "FAILED";

export interface QueueItem {
  readonly id: string;
  readonly kind: QueueItemKind;
  /** İçerik hash'i (SHA-256 hex) — idempotens anahtarı. */
  readonly contentHash: string;
  /** Popup'ta gösterilen kısa Türkçe etiket. */
  readonly label: string;
  /** İlgili UYAP dosya numarası (varsa) — hata listesinde bağlam verir. */
  readonly uyapDosyaNo: string | null;
  /**
   * Gönderilecek gövde; `kind`'a göre yorumlanır.
   * Öğe DONE/DUPLICATE olduğunda `null`'a çekilir — aktarımı biten veri (özellikle
   * evrak baytları) yerelde tutulmaz (KVKK veri minimizasyonu, denetim bulgusu 7).
   * FAILED öğelerde gövde korunur; kullanıcı "Yeniden dene" diyebilsin diye. Kalıcı
   * hatalı evrakı diskten silmek için popup'taki "Kuyruğu temizle" kullanılır.
   */
  readonly payload: unknown;
  readonly status: QueueItemStatus;
  readonly attempts: number;
  /** Bir sonraki deneme zamanı (epoch ms). */
  readonly nextAttemptAt: number;
  readonly lastError: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Kuyruk sürücüsünün tek bir öğe için beklediği sonuç. */
export type ProcessOutcome =
  | { readonly result: "DONE" }
  | { readonly result: "DUPLICATE" }
  /** Geçici hata — üstel geri çekilme ile tekrar denenir. */
  | { readonly result: "RETRY"; readonly error: string }
  /** Kalıcı hata — tekrar denenmez, kullanıcıya bildirilir. */
  | { readonly result: "FAILED"; readonly error: string };

export type QueueProcessor = (item: QueueItem) => Promise<ProcessOutcome>;

export interface QueueSnapshot {
  readonly pending: number;
  readonly failed: number;
  readonly done: number;
  readonly duplicates: number;
  /** Popup'ta listelenecek son öğeler (en yeni önce). */
  readonly items: readonly QueueItem[];
}

/** Kuyruğa ekleme sonucu. */
export interface EnqueueResult {
  readonly added: boolean;
  /** added=false ise nedeni. */
  readonly reason: "DUPLICATE_IN_QUEUE" | "ALREADY_SENT" | null;
  readonly id: string | null;
}
