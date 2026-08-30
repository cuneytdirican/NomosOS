/**
 * Kullanıcıya görünür olay/hata günlüğü (popup'taki "Hatalar" listesi).
 * Yalnızca eklenti içinde tutulur, dışarı gönderilmez; belge içeriği loglanmaz.
 */

import { STORAGE_KEYS, readLocal, updateLocal } from "./storage";
import type { LogEntry } from "../types/state";

const MAX_ENTRIES = 100;

async function append(entry: LogEntry): Promise<void> {
  await updateLocal<LogEntry[]>(STORAGE_KEYS.logs, [], (current) => {
    const next = [entry, ...current];
    return next.slice(0, MAX_ENTRIES);
  });
}

export async function logInfo(scope: string, message: string, detail?: string): Promise<void> {
  await append({ at: Date.now(), level: "info", scope, message, detail });
}

export async function logWarn(scope: string, message: string, detail?: string): Promise<void> {
  await append({ at: Date.now(), level: "warn", scope, message, detail });
}

export async function logError(scope: string, message: string, detail?: string): Promise<void> {
  await append({ at: Date.now(), level: "error", scope, message, detail });
  console.error(`[nomosos-uyap][${scope}] ${message}`, detail ?? "");
}

export async function getLogs(): Promise<readonly LogEntry[]> {
  return readLocal<LogEntry[]>(STORAGE_KEYS.logs, []);
}

export async function clearLogs(): Promise<void> {
  await updateLocal<LogEntry[]>(STORAGE_KEYS.logs, [], () => []);
}
