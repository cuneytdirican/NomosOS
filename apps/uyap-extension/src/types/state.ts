/** Eklenti ayarları, oturum ve popup'a gösterilen durum tipleri. */

import type { PairedIdentity, StatusResponse } from "./dto";
import type { QueueSnapshot } from "./queue";

export interface ExtensionSettings {
  /** NomosOS backend kök adresi (ör. "https://app.nomosos.com" veya self-hosted). */
  readonly apiBaseUrl: string;
  /** Periyodik senkron açık mı? */
  readonly autoSyncEnabled: boolean;
  /** Periyodik senkron aralığı (dakika, 5–1440). */
  readonly syncIntervalMinutes: number;
  /** UYAP sayfalarına "NomosOS'a aktar" düğmeleri enjekte edilsin mi? */
  readonly injectButtons: boolean;
  /** Tek evrak için üst sınır (byte) — aşan evrak kuyruğa alınmaz, uyarı verilir. */
  readonly maxDocumentBytes: number;
  /** Cihaz adı — eşleştirmede backend'e bildirilir. */
  readonly deviceName: string;
}

/** chrome.storage.local'da saklanan oturum. Asla chrome.storage.sync'e YAZILMAZ. */
export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch ms. */
  readonly accessTokenExpiresAt: number;
  readonly identity: PairedIdentity;
  /** Eşleştirmenin yapıldığı backend adresi — ayar değişirse oturum geçersizdir. */
  readonly apiBaseUrl: string;
  /**
   * Sunucunun eşleştirmede bildirdiği ön-imzalı depo ana bilgisayarları.
   * `uploadUrl` doğrulaması bu listeye bakar; boşsa yalnız API ana bilgisayarına
   * yükleme yapılabilir. Eski (bu alanı içermeyen) oturumlarda `undefined` olabilir.
   */
  readonly storageHosts?: readonly string[];
  readonly pairedAt: number;
}

/** Eklentinin çalışma durumu (senkron zamanları, sayaçlar). */
export interface RuntimeState {
  /** Son başarılı senkron anı (epoch ms) veya null. */
  readonly lastSyncAt: number | null;
  /** Son senkron denemesi (başarısız da olabilir). */
  readonly lastAttemptAt: number | null;
  readonly lastSyncError: string | null;
  /** Bu tarayıcıda bu oturumda görülen/aktarılan dosya numaraları. */
  readonly seenDosyaNos: readonly string[];
  /** Backend'den alınan son durum özeti. */
  readonly lastStatus: StatusResponse | null;
  /** Parser kırılması tespit edildiyse senkron durur ve bu alan dolar. */
  readonly parserAlert: ParserAlert | null;
}

export interface ParserAlert {
  readonly kind: string;
  readonly selectorVersion: string;
  readonly message: string;
  readonly at: number;
  readonly url: string;
}

/** Kullanıcıya gösterilen hata/olay günlüğü kaydı. */
export interface LogEntry {
  readonly at: number;
  readonly level: "info" | "warn" | "error";
  readonly scope: string;
  readonly message: string;
  readonly detail?: string;
}

/** Popup'ın tek çağrıda aldığı bütün görünüm verisi. */
export interface PopupState {
  readonly paired: boolean;
  readonly identity: PairedIdentity | null;
  readonly settings: ExtensionSettings;
  readonly runtime: RuntimeState;
  readonly queue: QueueSnapshot;
  readonly logs: readonly LogEntry[];
  readonly extensionVersion: string;
}
