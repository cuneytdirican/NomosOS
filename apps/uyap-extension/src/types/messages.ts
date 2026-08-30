/**
 * Eklenti içi mesaj sözleşmesi (content script / popup → service worker).
 * Tüm mesajlar tipli; service worker `switch` ile tam kapsamlı ele alır.
 */

import type { PendingDocument, SyncTrigger } from "./dto";
import type { ParseFailure } from "./parser";
import type { ExtensionSettings, PopupState } from "./state";
import type { QueueSnapshot } from "./queue";
import type {
  UyapDosyaDetay,
  UyapDosyaOzeti,
  UyapDurusmaKaydi,
  UyapSafahatKaydi,
} from "./uyap";

export type ExtensionMessage =
  | { readonly type: "PING" }
  | { readonly type: "GET_POPUP_STATE" }
  | { readonly type: "PAIR"; readonly pairingCode: string; readonly apiBaseUrl: string }
  | { readonly type: "UNPAIR" }
  | { readonly type: "SYNC_NOW"; readonly trigger: SyncTrigger }
  | { readonly type: "GET_SETTINGS" }
  | { readonly type: "SAVE_SETTINGS"; readonly patch: Partial<ExtensionSettings> }
  | { readonly type: "GET_QUEUE" }
  | { readonly type: "RETRY_FAILED" }
  | { readonly type: "CLEAR_QUEUE" }
  /** İçerik betiği: dosya listesi/detay aktarımı. */
  | {
      readonly type: "TRANSFER_FILES";
      readonly files: readonly UyapDosyaOzeti[];
      readonly detay?: UyapDosyaDetay | null;
      readonly trigger: SyncTrigger;
      readonly sourceHost: string;
      readonly selectorVersion: string;
    }
  /** İçerik betiği: safahat + duruşma aktarımı. */
  | {
      readonly type: "TRANSFER_EVENTS";
      readonly uyapDosyaNo: string;
      readonly events: readonly UyapSafahatKaydi[];
      readonly hearings: readonly UyapDurusmaKaydi[];
      readonly trigger: SyncTrigger;
      readonly sourceHost: string;
      readonly selectorVersion: string;
    }
  /** İçerik betiği: indirilmiş evrakların aktarımı. */
  | {
      readonly type: "TRANSFER_DOCUMENTS";
      readonly documents: readonly PendingDocument[];
      readonly sourceHost: string;
      readonly selectorVersion: string;
    }
  /** İçerik betiği: parser kırıldı — senkron durur, kullanıcı uyarılır. */
  | {
      readonly type: "PARSER_FAILURE";
      readonly kind: string;
      readonly selectorVersion: string;
      readonly url: string;
      readonly failure: ParseFailure;
    }
  /**
   * İçerik betiği: bu ekran türü başarıyla okundu.
   * Kalıcı yanlış uyarıyı önler — bir kırılmadan sonra ekran yeniden okunabiliyorsa
   * `parserAlert` temizlenir (denetim bulgusu 12).
   */
  | { readonly type: "PARSER_OK"; readonly kind: string; readonly selectorVersion: string }
  /** İçerik betiği: sayfa tanındı (teşhis/telemetri, veri taşımaz). */
  | { readonly type: "PAGE_DETECTED"; readonly kind: string; readonly url: string };

/** Mesaj tipinden dönüş verisine eşleme. */
export interface MessageResultMap {
  PING: { readonly pong: true };
  GET_POPUP_STATE: PopupState;
  PAIR: { readonly paired: true };
  UNPAIR: { readonly paired: false };
  SYNC_NOW: { readonly queued: number };
  GET_SETTINGS: ExtensionSettings;
  SAVE_SETTINGS: ExtensionSettings;
  GET_QUEUE: QueueSnapshot;
  RETRY_FAILED: { readonly requeued: number };
  CLEAR_QUEUE: { readonly cleared: number };
  TRANSFER_FILES: { readonly queued: number; readonly duplicates: number };
  TRANSFER_EVENTS: { readonly queued: number; readonly duplicates: number };
  TRANSFER_DOCUMENTS: { readonly queued: number; readonly duplicates: number };
  PARSER_FAILURE: { readonly recorded: true };
  PARSER_OK: { readonly cleared: boolean };
  PAGE_DETECTED: { readonly acknowledged: true };
}

export type MessageType = ExtensionMessage["type"];

/** Service worker → içerik betiği komutları (chrome.tabs.sendMessage). */
export type ContentCommand =
  | { readonly type: "CONTENT_SCAN"; readonly trigger: SyncTrigger }
  | { readonly type: "CONTENT_PING" };

/** İçerik betiğinin tarama sonucu. */
export interface ContentScanResult {
  readonly kinds: readonly string[];
  readonly queuedFiles: number;
  readonly queuedEvents: number;
  readonly queuedDocuments: number;
  /** Kullanıcıya gösterilecek Türkçe hata/uyarı metinleri. */
  readonly errors: readonly string[];
}

export type MessageResponse<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/** Belirli bir mesaj tipi için tipli gönderim. */
export async function sendMessage<T extends MessageType>(
  message: Extract<ExtensionMessage, { type: T }>,
): Promise<MessageResponse<MessageResultMap[T]>> {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as
      | MessageResponse<MessageResultMap[T]>
      | undefined;
    if (!response) {
      return {
        ok: false,
        error: { code: "NO_RESPONSE", message: "Eklenti arka plan servisi yanıt vermedi." },
      };
    }
    return response;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "MESSAGE_FAILED",
        message:
          error instanceof Error
            ? `Arka plan servisine ulaşılamadı: ${error.message}`
            : "Arka plan servisine ulaşılamadı.",
      },
    };
  }
}
