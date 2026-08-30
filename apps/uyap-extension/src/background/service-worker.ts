/**
 * NomosOS UYAP Köprüsü — arka plan servisi (MV3 service worker).
 *
 * Sorumlulukları:
 *  - Mesaj yönlendirme (içerik betiği ve popup → tipli işleyiciler)
 *  - `chrome.alarms` ile periyodik senkron (varsayılan 30 dk, ayarlanabilir)
 *  - Extension token yenileme (lib/auth) ve kuyruk sürücüsü (sync-queue)
 *
 * Tarayıcı kapalıyken senkron ÇALIŞMAZ; popup bunu "Son senkron: …" ile dürüstçe gösterir
 * (docs/05 § 3).
 */

import {
  clearQueue,
  drain,
  enqueueMany,
  getSnapshot,
  hasPendingWork,
  resetInflight,
  retryFailed,
  type EnqueueInput,
} from "./sync-queue";
import * as api from "../lib/api";
import { clearSession, getSession, pairWithCode } from "../lib/auth";
import { ApiError, messageForCode, toUserMessage } from "../lib/errors";
import { base64ToBytes, contentHash, eventHash, hearingHash, sha256Bytes } from "../lib/hash";
import { getLogs, logError, logInfo, logWarn } from "../lib/logger";
import { getSettings, saveSettings } from "../lib/settings";
import { STORAGE_KEYS, readLocal, updateLocal } from "../lib/storage";
import { toSyncEventDto, toSyncFileDto, toSyncHearingDto } from "../types/dto";
import type {
  ClientInfo,
  PresignRequest,
  SyncEventDto,
  SyncEventsRequest,
  SyncFilesRequest,
  SyncHearingDto,
  SyncTrigger,
} from "../types/dto";
import type {
  ContentCommand,
  ContentScanResult,
  ExtensionMessage,
  MessageResponse,
} from "../types/messages";
import type { ProcessOutcome, QueueItem } from "../types/queue";
import type { ExtensionSettings, PopupState, RuntimeState } from "../types/state";

const ALARM_SYNC = "nomosos-uyap-periodic-sync";
const ALARM_QUEUE = "nomosos-uyap-queue-drive";
/** Kuyruk sürücüsü her dakika koşar; bekleyen iş yoksa hemen çıkar. */
const QUEUE_DRIVE_PERIOD_MINUTES = 1;

const UYAP_TAB_PATTERNS = ["https://avukatbeta.uyap.gov.tr/*", "https://avukat.uyap.gov.tr/*"];

const DEFAULT_RUNTIME: RuntimeState = {
  lastSyncAt: null,
  lastAttemptAt: null,
  lastSyncError: null,
  seenDosyaNos: [],
  lastStatus: null,
  parserAlert: null,
};

function extensionVersion(): string {
  return chrome.runtime.getManifest().version;
}

function buildClientInfo(selectorVersion: string, sourceHost: string): ClientInfo {
  return { extensionVersion: extensionVersion(), selectorVersion, sourceHost };
}

async function readRuntime(): Promise<RuntimeState> {
  return readLocal<RuntimeState>(STORAGE_KEYS.runtime, DEFAULT_RUNTIME);
}

async function patchRuntime(patch: Partial<RuntimeState>): Promise<RuntimeState> {
  return updateLocal<RuntimeState>(STORAGE_KEYS.runtime, DEFAULT_RUNTIME, (current) => ({
    ...current,
    ...patch,
  }));
}

async function rememberDosyaNos(dosyaNos: readonly string[]): Promise<void> {
  if (dosyaNos.length === 0) return;
  await updateLocal<RuntimeState>(STORAGE_KEYS.runtime, DEFAULT_RUNTIME, (current) => {
    const merged = new Set([...current.seenDosyaNos, ...dosyaNos]);
    return { ...current, seenDosyaNos: [...merged].slice(0, 1000) };
  });
}

/* ------------------------------------------------------------------ */
/* Alarmlar                                                            */
/* ------------------------------------------------------------------ */

async function scheduleAlarms(settings?: ExtensionSettings): Promise<void> {
  const current = settings ?? (await getSettings());
  await chrome.alarms.clear(ALARM_SYNC);
  if (current.autoSyncEnabled) {
    chrome.alarms.create(ALARM_SYNC, {
      periodInMinutes: current.syncIntervalMinutes,
      delayInMinutes: current.syncIntervalMinutes,
    });
  }
  await chrome.alarms.clear(ALARM_QUEUE);
  chrome.alarms.create(ALARM_QUEUE, {
    periodInMinutes: QUEUE_DRIVE_PERIOD_MINUTES,
    delayInMinutes: QUEUE_DRIVE_PERIOD_MINUTES,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await resetInflight();
    await scheduleAlarms();
    await logInfo("kurulum", "NomosOS UYAP Köprüsü kuruldu/güncellendi.");
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    // Service worker yeniden başladı: yarıda kalan gönderimleri geri al.
    await resetInflight();
    await scheduleAlarms();
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void (async () => {
    if (alarm.name === ALARM_QUEUE) {
      if (await hasPendingWork()) await driveQueue();
      return;
    }
    if (alarm.name === ALARM_SYNC) {
      await runSync("SCHEDULED");
    }
  })();
});

/* ------------------------------------------------------------------ */
/* Kuyruk sürücüsü                                                     */
/* ------------------------------------------------------------------ */

interface DocumentQueuePayload {
  readonly presign: PresignRequest;
  readonly base64: string;
  readonly evrakTuru: string | null;
  readonly evrakTarihi: string | null;
  readonly gonderen: string | null;
}

/* ------------------------------------------------------------------ */
/* Kuyruk gövdesi doğrulama                                            */
/* ------------------------------------------------------------------ */

/**
 * DÜZELTİLDİ (kod tutarlılık denetimi, bulgu 13): gövdeler `item.payload as X`
 * ile körlemesine cast ediliyordu. `chrome.storage.local`'dan gelen ESKİ ŞEMALI
 * (ya da tamamlandığı için boşaltılmış) bir kayıt sessizce yanlış alana giderdi.
 * Artık her gövde işlenmeden önce şekil olarak doğrulanır; uymayan öğe sessizce
 * gönderilmez, kalıcı hata (FAILED) olarak kullanıcıya görünür.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSyncFilesRequest(payload: unknown): SyncFilesRequest | null {
  if (!isRecord(payload) || !isRecord(payload.client) || !Array.isArray(payload.files)) return null;
  return payload as unknown as SyncFilesRequest;
}

function asSyncEventsRequest(payload: unknown): SyncEventsRequest | null {
  if (!isRecord(payload) || !isRecord(payload.client)) return null;
  if (typeof payload.uyapDosyaNo !== "string" || payload.uyapDosyaNo.length === 0) return null;
  if (!Array.isArray(payload.events)) return null;
  if (payload.hearings !== undefined && !Array.isArray(payload.hearings)) return null;
  return payload as unknown as SyncEventsRequest;
}

function asDocumentPayload(payload: unknown): DocumentQueuePayload | null {
  if (!isRecord(payload) || !isRecord(payload.presign)) return null;
  if (typeof payload.base64 !== "string" || payload.base64.length === 0) return null;
  return payload as unknown as DocumentQueuePayload;
}

const CORRUPT_PAYLOAD_MESSAGE =
  "Kuyruktaki kayıt beklenen biçimde değil (eski sürümden kalmış olabilir); yanlış veri göndermemek için aktarılmadı. Kuyruğu temizleyip yeniden aktarın.";

function outcomeFromError(error: unknown): ProcessOutcome {
  if (error instanceof ApiError) {
    if (error.code === "CONFLICT") return { result: "DUPLICATE" };
    return error.retryable
      ? { result: "RETRY", error: error.message }
      : { result: "FAILED", error: error.message };
  }
  return { result: "RETRY", error: toUserMessage(error) };
}

async function processItem(item: QueueItem): Promise<ProcessOutcome> {
  try {
    if (item.kind === "SYNC_FILES") {
      const payload = asSyncFilesRequest(item.payload);
      if (!payload) return { result: "FAILED", error: CORRUPT_PAYLOAD_MESSAGE };
      const response = await api.syncFiles(payload);
      if (response.unmatched.length > 0) {
        await logWarn(
          "senkron",
          `${response.unmatched.length} dosya NomosOS'ta eşleşmedi; eşleştirme kuyruğuna düştü.`,
          response.unmatched.join(", "),
        );
      }
      return { result: "DONE" };
    }

    if (item.kind === "SYNC_EVENTS") {
      const payload = asSyncEventsRequest(item.payload);
      if (!payload) return { result: "FAILED", error: CORRUPT_PAYLOAD_MESSAGE };
      await api.syncEvents(payload);
      return { result: "DONE" };
    }

    const payload = asDocumentPayload(item.payload);
    if (!payload) return { result: "FAILED", error: CORRUPT_PAYLOAD_MESSAGE };
    const bytes = base64ToBytes(payload.base64);
    const response = await api.transferDocument({
      presign: payload.presign,
      bytes,
      evrakTuru: payload.evrakTuru,
      evrakTarihi: payload.evrakTarihi,
      gonderen: payload.gonderen,
    });
    return response.duplicate ? { result: "DUPLICATE" } : { result: "DONE" };
  } catch (error) {
    return outcomeFromError(error);
  }
}

let driving = false;

async function driveQueue(): Promise<void> {
  if (driving) return;
  driving = true;
  try {
    const session = await getSession();
    if (!session) return;
    let rounds = 0;
    // Bir turda en fazla 5 parti işlenir; kalanı bir sonraki alarmda sürer.
    while (rounds < 5) {
      const summary = await drain(processItem);
      if (summary.processed === 0) break;
      if (summary.failed > 0) {
        await logError("kuyruk", `${summary.failed} aktarım kalıcı olarak başarısız oldu.`);
      }
      if (summary.done > 0 || summary.duplicates > 0) {
        await patchRuntime({ lastSyncAt: Date.now(), lastSyncError: null });
      }
      rounds += 1;
    }
  } catch (error) {
    await logError("kuyruk", "Kuyruk sürücüsü hata verdi.", toUserMessage(error));
  } finally {
    driving = false;
  }
}

/* ------------------------------------------------------------------ */
/* Senkron tetikleyici                                                 */
/* ------------------------------------------------------------------ */

/**
 * Açık UYAP sekmelerine "tara ve aktar" komutu gönderir.
 * Eklenti UYAP'a ARKA PLANDA istek atmaz; yalnızca kullanıcının açık oturumundaki
 * sayfaların içeriğini okur (docs/05 § 3 — tarayıcı kapalıyken senkron olmaz).
 */
async function runSync(trigger: SyncTrigger): Promise<number> {
  await patchRuntime({ lastAttemptAt: Date.now() });

  const session = await getSession();
  if (!session) {
    await patchRuntime({ lastSyncError: messageForCode("NOT_PAIRED") });
    return 0;
  }

  const runtime = await readRuntime();
  if (runtime.parserAlert) {
    // Uyarı YALNIZCA ilgili ekran türü için geçerlidir: o ekran bir daha başarıyla
    // okunduğunda içerik betiği PARSER_OK gönderir ve uyarı temizlenir (bulgu 12).
    await logWarn(
      "senkron",
      `"${runtime.parserAlert.kind}" ekranı okunamamıştı; diğer aktarımlar sürüyor.`,
      runtime.parserAlert.message,
    );
  }

  // NOT: manifest'te bilinçli olarak "tabs" izni YOKTUR. `chrome.tabs.query({url})`
  // burada host_permissions (UYAP kalıpları) üzerinden çalışır (Chrome 88+ davranışı).
  // Host izinleri daraltılırsa bu çağrı sessizce boş dizi döner — o durumda kullanıcıya
  // "Açık UYAP sekmesi yok" mesajı gösterilir (bulgu: kod 15).
  const tabs = await chrome.tabs.query({ url: UYAP_TAB_PATTERNS });
  let queued = 0;
  const errors: string[] = [];

  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const command: ContentCommand = { type: "CONTENT_SCAN", trigger };
    try {
      const result = (await chrome.tabs.sendMessage(tab.id, command)) as ContentScanResult | undefined;
      if (!result) continue;
      queued += result.queuedFiles + result.queuedEvents + result.queuedDocuments;
      errors.push(...result.errors);
    } catch {
      // Sekmede içerik betiği yok (ör. giriş sayfası) — sessizce atlanır.
    }
  }

  if (tabs.length === 0) {
    await patchRuntime({
      lastSyncError: "Açık UYAP sekmesi yok. Senkron için UYAP Avukat Portalı'nı açık tutun.",
    });
  } else {
    await patchRuntime({ lastSyncError: errors.length > 0 ? errors[0] : null });
  }

  await driveQueue();
  await refreshStatus();
  return queued;
}

/** Backend'den özet durum çeker (izlenen dosya, onay bekleyen sayısı). */
async function refreshStatus(): Promise<void> {
  try {
    const status = await api.fetchStatus();
    await patchRuntime({ lastStatus: status });
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_PAIRED") return;
    await logWarn("durum", "NomosOS durum bilgisi alınamadı.", toUserMessage(error));
  }
}

/* ------------------------------------------------------------------ */
/* Aktarım kuyruğuna ekleme (içerik betiğinden gelen veriler)          */
/* ------------------------------------------------------------------ */

async function queueFiles(message: Extract<ExtensionMessage, { type: "TRANSFER_FILES" }>) {
  const client = buildClientInfo(message.selectorVersion, message.sourceHost);
  const detay = message.detay ?? null;
  const files = message.files.map((file) =>
    detay && detay.dosyaNo === file.dosyaNo
      ? toSyncFileDto(file, { konu: detay.konu, taraflar: detay.taraflar })
      : toSyncFileDto(file),
  );
  if (files.length === 0) return { queued: 0, duplicates: 0 };

  const payload: SyncFilesRequest = { client, files, trigger: message.trigger };
  const hash = await contentHash({ kind: "SYNC_FILES", files });
  const label =
    files.length === 1 ? `Dosya: ${files[0].uyapDosyaNo}` : `${files.length} dosya aktarımı`;

  const result = await enqueueMany([
    { kind: "SYNC_FILES", contentHash: hash, label, uyapDosyaNo: files[0].uyapDosyaNo, payload },
  ]);
  await rememberDosyaNos(files.map((file) => file.uyapDosyaNo));
  await driveQueue();
  return { queued: result.queued, duplicates: result.duplicates };
}

async function queueEvents(message: Extract<ExtensionMessage, { type: "TRANSFER_EVENTS" }>) {
  const client = buildClientInfo(message.selectorVersion, message.sourceHost);

  const events: SyncEventDto[] = [];
  for (const kayit of message.events) {
    const hash = await eventHash({
      uyapDosyaNo: message.uyapDosyaNo,
      tarih: kayit.tarih,
      islem: kayit.islem,
      aciklama: kayit.aciklama,
    });
    events.push(toSyncEventDto(kayit, hash));
  }

  const hearings: SyncHearingDto[] = [];
  for (const durusma of message.hearings) {
    // Güvenlik ağı (bulgu 1): içerik betiği duruşmaları dosya numarasına göre grupluyor;
    // yine de gövdedeki dosya numarasıyla uyuşmayan bir kayıt buraya düşerse ATLANIR.
    if (durusma.dosyaNo !== null && durusma.dosyaNo !== message.uyapDosyaNo) {
      await logWarn(
        "duruşma",
        `Duruşma kaydı gövdedeki dosya numarasıyla uyuşmadığı için aktarılmadı (${durusma.dosyaNo} ≠ ${message.uyapDosyaNo}).`,
      );
      continue;
    }
    const hash = await hearingHash({
      uyapDosyaNo: message.uyapDosyaNo,
      tarih: durusma.tarih,
      salon: durusma.salon,
      tur: durusma.tur,
    });
    hearings.push(toSyncHearingDto(durusma, hash, message.uyapDosyaNo));
  }

  if (events.length === 0 && hearings.length === 0) return { queued: 0, duplicates: 0 };

  const payload: SyncEventsRequest = {
    client,
    uyapDosyaNo: message.uyapDosyaNo,
    events,
    hearings,
    trigger: message.trigger,
  };
  const hash = await contentHash({
    kind: "SYNC_EVENTS",
    uyapDosyaNo: message.uyapDosyaNo,
    events: events.map((event) => event.externalHash),
    hearings: hearings.map((hearing) => hearing.externalHash),
  });

  const result = await enqueueMany([
    {
      kind: "SYNC_EVENTS",
      contentHash: hash,
      label: `Safahat: ${message.uyapDosyaNo} (${events.length} kayıt)`,
      uyapDosyaNo: message.uyapDosyaNo,
      payload,
    },
  ]);
  await rememberDosyaNos([message.uyapDosyaNo]);
  await driveQueue();
  return { queued: result.queued, duplicates: result.duplicates };
}

async function queueDocuments(message: Extract<ExtensionMessage, { type: "TRANSFER_DOCUMENTS" }>) {
  const client = buildClientInfo(message.selectorVersion, message.sourceHost);
  const settings = await getSettings();
  const inputs: EnqueueInput[] = [];

  for (const doc of message.documents) {
    if (doc.sizeBytes > settings.maxDocumentBytes) {
      await logWarn("evrak", `"${doc.fileName}" boyut sınırını aştığı için aktarılmadı.`);
      continue;
    }
    // Hash, evrakın HAM İÇERİĞİNDEN hesaplanır: aynı evrak farklı adla gelse de yinelenmez.
    const hash = await sha256Bytes(base64ToBytes(doc.base64));
    const presign: PresignRequest = {
      client,
      uyapDosyaNo: doc.uyapDosyaNo,
      uyapEvrakId: doc.uyapEvrakId,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      contentHash: hash,
    };
    const payload: DocumentQueuePayload = {
      presign,
      base64: doc.base64,
      evrakTuru: doc.evrakTuru,
      evrakTarihi: doc.evrakTarihi,
      gonderen: doc.gonderen,
    };
    inputs.push({
      kind: "DOCUMENT",
      contentHash: hash,
      label: `Evrak: ${doc.fileName}`,
      uyapDosyaNo: doc.uyapDosyaNo,
      payload,
    });
  }

  if (inputs.length === 0) return { queued: 0, duplicates: 0 };
  const result = await enqueueMany(inputs);
  await driveQueue();
  return { queued: result.queued, duplicates: result.duplicates };
}

/* ------------------------------------------------------------------ */
/* Popup durumu                                                        */
/* ------------------------------------------------------------------ */

async function buildPopupState(): Promise<PopupState> {
  const [session, settings, runtime, queue, logs] = await Promise.all([
    getSession(),
    getSettings(),
    readRuntime(),
    getSnapshot(25),
    getLogs(),
  ]);
  return {
    paired: session !== null,
    identity: session?.identity ?? null,
    settings,
    runtime,
    queue,
    logs: logs.slice(0, 25),
    extensionVersion: extensionVersion(),
  };
}

/* ------------------------------------------------------------------ */
/* Mesaj yönlendirme                                                   */
/* ------------------------------------------------------------------ */

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case "PING":
      return { pong: true };

    case "GET_POPUP_STATE":
      return buildPopupState();

    case "PAIR": {
      const settings = await saveSettings({ apiBaseUrl: message.apiBaseUrl });
      await pairWithCode({
        pairingCode: message.pairingCode,
        apiBaseUrl: settings.apiBaseUrl,
        deviceName: settings.deviceName,
        extensionVersion: extensionVersion(),
      });
      await scheduleAlarms(settings);
      await patchRuntime({ lastSyncError: null, parserAlert: null });
      await logInfo("eşleştirme", "Eklenti NomosOS bürosuyla eşleştirildi.");
      await refreshStatus();
      return { paired: true };
    }

    case "UNPAIR": {
      await clearSession();
      await chrome.alarms.clear(ALARM_SYNC);
      await patchRuntime({ lastStatus: null });
      await logInfo("eşleştirme", "Eklenti bağlantısı kesildi; jetonlar silindi.");
      return { paired: false };
    }

    case "SYNC_NOW": {
      const queued = await runSync(message.trigger);
      return { queued };
    }

    case "GET_SETTINGS":
      return getSettings();

    case "SAVE_SETTINGS": {
      const settings = await saveSettings(message.patch);
      await scheduleAlarms(settings);
      return settings;
    }

    case "GET_QUEUE":
      return getSnapshot(50);

    case "RETRY_FAILED": {
      const requeued = await retryFailed();
      await driveQueue();
      return { requeued };
    }

    case "CLEAR_QUEUE": {
      const cleared = await clearQueue();
      return { cleared };
    }

    case "TRANSFER_FILES":
      return queueFiles(message);

    case "TRANSFER_EVENTS":
      return queueEvents(message);

    case "TRANSFER_DOCUMENTS":
      return queueDocuments(message);

    case "PARSER_FAILURE": {
      // Sessiz yanlış veri yerine görünür arıza: kullanıcı uyarılır, senkron güvenilmez sayılır.
      await patchRuntime({
        parserAlert: {
          kind: message.kind,
          selectorVersion: message.selectorVersion,
          message: message.failure.message,
          at: Date.now(),
          url: message.url,
        },
      });
      await logError(
        "parser",
        `UYAP sayfası okunamadı (${message.kind}).`,
        `${message.failure.message} | Kırılan alanlar: ${message.failure.issues
          .map((issue) => `${issue.field} → ${issue.selector}`)
          .join(" ; ")}`,
      );
      return { recorded: true };
    }

    case "PARSER_OK": {
      // Aynı ekran türü yeniden okunabildiyse uyarı KALDIRILIR; aksi halde kullanıcı
      // tek seferlik bir kırılmadan sonra kalıcı ve artık doğru olmayan bir uyarı görürdü.
      const runtime = await readRuntime();
      if (runtime.parserAlert && runtime.parserAlert.kind === message.kind) {
        await patchRuntime({ parserAlert: null });
        await logInfo("parser", `"${message.kind}" ekranı yeniden okunabiliyor; uyarı kaldırıldı.`);
        return { cleared: true };
      }
      return { cleared: false };
    }

    case "PAGE_DETECTED":
      return { acknowledged: true };

    default: {
      // Tip düzeyinde kapsam denetimi: yeni mesaj tipi eklenirse burada derleme hatası alınır.
      const exhaustive: never = message;
      throw new Error(`Bilinmeyen mesaj: ${JSON.stringify(exhaustive)}`);
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      const data = await handleMessage(message as ExtensionMessage);
      const response: MessageResponse<unknown> = { ok: true, data };
      sendResponse(response);
    } catch (error) {
      const response: MessageResponse<never> = {
        ok: false,
        error: {
          code: error instanceof ApiError ? error.code : "UNKNOWN",
          message: toUserMessage(error),
        },
      };
      await logError("mesaj", toUserMessage(error));
      sendResponse(response);
    }
  })();
  // Asenkron yanıt için kanalı açık tut.
  return true;
});

/** Ayarlar başka bir bağlamda değiştiyse alarmları yeniden kur. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEYS.settings]) return;
  void scheduleAlarms();
});
