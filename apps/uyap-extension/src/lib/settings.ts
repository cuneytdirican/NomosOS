/** Eklenti ayarları: varsayılanlar, doğrulama ve kalıcılık. */

import { STORAGE_KEYS, readLocal, updateLocal } from "./storage";
import type { ExtensionSettings } from "../types/state";

/** Senkron aralığı sınırları (dakika). */
export const MIN_SYNC_INTERVAL_MINUTES = 5;
export const MAX_SYNC_INTERVAL_MINUTES = 1440;

/** Tek evrak için varsayılan üst sınır: 25 MB. */
export const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * Tek evrak için ayarlanabilir mutlak üst sınır: 50 MB.
 *
 * DÜZELTİLDİ (denetim bulguları: hukuki 8 / kod 9): eski sınır 200 MB idi. Evrak
 * baytları base64 olarak (≈ %33 şişme) hem `chrome.runtime.sendMessage` mesajında hem
 * `chrome.storage.local` kuyruğunda taşınıyor; 200 MB'lık bir evrak her iki yolda da
 * sessizce düşerdi. Ek önlemler: manifest'e `unlimitedStorage` eklendi, evraklar TEK TEK
 * mesajlanıyor ve gönderimi biten kuyruk öğesinin baytları hemen siliniyor.
 */
export const MAX_DOCUMENT_BYTES_LIMIT = 50 * 1024 * 1024;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBaseUrl: "https://app.nomosos.com",
  autoSyncEnabled: true,
  syncIntervalMinutes: 30,
  injectButtons: true,
  maxDocumentBytes: DEFAULT_MAX_DOCUMENT_BYTES,
  deviceName: "Chrome",
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

/** Kullanıcı girdisini güvenli hale getirir; hatalı değerler varsayılana döner. */
export function normalizeSettings(patch: Partial<ExtensionSettings>, base: ExtensionSettings): ExtensionSettings {
  const merged: ExtensionSettings = { ...base, ...patch };
  return {
    apiBaseUrl: normalizeBaseUrl(merged.apiBaseUrl) ?? DEFAULT_SETTINGS.apiBaseUrl,
    autoSyncEnabled: Boolean(merged.autoSyncEnabled),
    syncIntervalMinutes: clamp(
      Number(merged.syncIntervalMinutes),
      MIN_SYNC_INTERVAL_MINUTES,
      MAX_SYNC_INTERVAL_MINUTES,
    ),
    injectButtons: Boolean(merged.injectButtons),
    maxDocumentBytes: clamp(Number(merged.maxDocumentBytes), 1024, MAX_DOCUMENT_BYTES_LIMIT),
    deviceName: (merged.deviceName || DEFAULT_SETTINGS.deviceName).slice(0, 60),
  };
}

/**
 * Backend adresini normalize eder: yalnızca https kabul edilir
 * (localhost geliştirme adresleri hariç), sondaki eğik çizgi atılır.
 */
export function normalizeBaseUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) return null;
    const origin = `${url.protocol}//${url.host}`;
    const path = url.pathname.replace(/\/+$/, "");
    return path && path !== "/" ? `${origin}${path}` : origin;
  } catch {
    return null;
  }
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await readLocal<Partial<ExtensionSettings>>(STORAGE_KEYS.settings, {});
  return normalizeSettings(stored, DEFAULT_SETTINGS);
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  return updateLocal<ExtensionSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS, (current) =>
    normalizeSettings(patch, normalizeSettings(current, DEFAULT_SETTINGS)),
  );
}
