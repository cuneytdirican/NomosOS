/**
 * chrome.storage.local sarmalayıcısı.
 *
 * GÜVENLİK: Eklentinin tüm hassas verisi (extension token, oturum) YALNIZCA
 * `chrome.storage.local`'da tutulur. `chrome.storage.sync` KULLANILMAZ — sync alanı
 * kullanıcının Google hesabına kopyalanır ve büro verisinin tenant dışına çıkmasına
 * yol açardı.
 */

export const STORAGE_KEYS = {
  auth: "nomosos.auth.v1",
  settings: "nomosos.settings.v1",
  queue: "nomosos.queue.v1",
  ledger: "nomosos.ledger.v1",
  runtime: "nomosos.runtime.v1",
  logs: "nomosos.logs.v1",
  /** Aktarılmış evrakların (dosyaNo+evrakId) defteri — gereksiz yeniden indirmeyi önler. */
  evrak: "nomosos.evrak.v1",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export async function readLocal<T>(key: StorageKey, fallback: T): Promise<T> {
  const bag = await chrome.storage.local.get(key);
  const value = bag[key] as T | undefined;
  return value === undefined ? fallback : value;
}

export async function writeLocal<T>(key: StorageKey, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeLocal(key: StorageKey): Promise<void> {
  await chrome.storage.local.remove(key);
}

/**
 * Basit sıraya alma kilidi.
 * Service worker tek örnek çalışır ama alarm + mesaj işleyicileri eşzamanlı tetiklenebilir;
 * kuyruk dosyasını okuyup yazan işlemler bu kilit üzerinden serileştirilir
 * (aksi halde "read-modify-write" yarışı kayıt kaybettirir).
 */
const locks = new Map<string, Promise<unknown>>();

export function withLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(name) ?? Promise.resolve();
  const next = previous.then(task, task);
  locks.set(
    name,
    next.catch(() => undefined),
  );
  return next;
}

/** Kilitli oku-değiştir-yaz. */
export async function updateLocal<T>(
  key: StorageKey,
  fallback: T,
  updater: (current: T) => T | Promise<T>,
): Promise<T> {
  return withLock(key, async () => {
    const current = await readLocal<T>(key, fallback);
    const next = await updater(current);
    await writeLocal(key, next);
    return next;
  });
}
