/**
 * İdempotent aktarım kuyruğu.
 *
 * GARANTİLER
 * 1. Yinelenme koruması: her öğenin bir içerik hash'i (SHA-256) vardır. Aynı hash
 *    kuyrukta bekliyorsa ya da "gönderilmiş defterinde" (ledger) kayıtlıysa öğe kuyruğa
 *    TEKRAR ALINMAZ. Aynı evrak iki kez yüklenmez (docs/05 § 2.4).
 * 2. Kalıcılık: kuyruk `chrome.storage.local`'da durur; tarayıcı kapanıp açılsa da
 *    service worker uykuya dalsa da kayıp olmaz.
 * 3. Yeniden deneme: geçici hatalarda üstel geri çekilme (15 sn → 30 dk, ±%20 jitter),
 *    `maxAttempts` sonunda öğe FAILED olur ve popup'ta kullanıcıya gösterilir.
 * 4. Sıra bozulmaz: kuyruk mutasyonları tek kilit üzerinden serileştirilir.
 */

import { STORAGE_KEYS, readLocal, updateLocal, withLock } from "../lib/storage";
import type {
  EnqueueResult,
  ProcessOutcome,
  QueueItem,
  QueueItemKind,
  QueueProcessor,
  QueueSnapshot,
} from "../types/queue";

export const QUEUE_CONFIG = {
  /** Kalıcı hata sayılmadan önceki deneme sayısı. */
  maxAttempts: 6,
  baseDelayMs: 15_000,
  maxDelayMs: 30 * 60_000,
  /** Kuyrukta tutulacak azami öğe (en eski tamamlananlar budanır). */
  maxItems: 500,
  /**
   * Tamamlanan ÜSTVERİ öğeleri (dosya/safahat) bu süre kadar kuyrukta kalır (24 saat) —
   * kullanıcı popup'ta "ne aktarıldı?" sorusunun cevabını görebilsin diye.
   * Gövde (payload) tamamlanır tamamlanmaz SİLİNİR; kalan yalnız etiket ve hash'tir.
   */
  doneRetentionMs: 24 * 60 * 60_000,
  /**
   * Tamamlanan EVRAK öğeleri hiç bekletilmez.
   *
   * DÜZELTİLDİ (hukuki/KVKK denetimi, bulgu 7): evrakın tamamı base64 olarak
   * `chrome.storage.local`'a yazılıyor ve işi bittikten sonra 24 saat daha şifresiz
   * duruyordu. Veri minimizasyonu/amaç sınırlılığı (docs/04) gereği kişisel veri yoğun
   * evrak, aktarımı biter bitmez yerelden silinir; yinelenme koruması hash defteriyle
   * (ledger) sürer.
   */
  documentDoneRetentionMs: 0,
  /** Gönderilmiş hash defterinin azami boyu. */
  ledgerLimit: 5_000,
  /** Bir sürücü turunda işlenecek azami öğe. */
  batchSize: 15,
} as const;

interface LedgerState {
  readonly hashes: string[];
}

const EMPTY_LEDGER: LedgerState = { hashes: [] };

function newId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Üstel geri çekilme + jitter. */
export function backoffDelayMs(attempts: number): number {
  const exponential = QUEUE_CONFIG.baseDelayMs * 2 ** Math.max(0, attempts - 1);
  const capped = Math.min(exponential, QUEUE_CONFIG.maxDelayMs);
  const jitter = capped * 0.2 * (Math.random() * 2 - 1);
  return Math.max(1_000, Math.round(capped + jitter));
}

async function readQueue(): Promise<QueueItem[]> {
  return readLocal<QueueItem[]>(STORAGE_KEYS.queue, []);
}

async function readLedger(): Promise<LedgerState> {
  return readLocal<LedgerState>(STORAGE_KEYS.ledger, EMPTY_LEDGER);
}

/** Tamamlanmış eski öğeleri ve taşan kayıtları budar. */
function prune(items: QueueItem[], now: number): QueueItem[] {
  const kept = items
    .filter((item) => {
      const finished = item.status === "DONE" || item.status === "DUPLICATE";
      if (!finished) return true;
      const retention =
        item.kind === "DOCUMENT" ? QUEUE_CONFIG.documentDoneRetentionMs : QUEUE_CONFIG.doneRetentionMs;
      return now - item.updatedAt < retention;
    })
    // KVKK: tamamlanmış öğenin gövdesi (evrak baytları dâhil) yerelde tutulmaz.
    .map((item) =>
      (item.status === "DONE" || item.status === "DUPLICATE") && item.payload !== null
        ? { ...item, payload: null }
        : item,
    );
  if (kept.length <= QUEUE_CONFIG.maxItems) return kept;
  const active = kept.filter((item) => item.status === "PENDING" || item.status === "INFLIGHT" || item.status === "FAILED");
  const finished = kept
    .filter((item) => item.status === "DONE" || item.status === "DUPLICATE")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, QUEUE_CONFIG.maxItems - active.length));
  return [...active, ...finished];
}

export interface EnqueueInput {
  readonly kind: QueueItemKind;
  readonly contentHash: string;
  readonly label: string;
  readonly uyapDosyaNo: string | null;
  readonly payload: unknown;
}

/** Tek öğe ekler (yinelenme kontrolüyle). */
export async function enqueue(input: EnqueueInput): Promise<EnqueueResult> {
  const result = await enqueueMany([input]);
  return result.results[0] ?? { added: false, reason: "DUPLICATE_IN_QUEUE", id: null };
}

/** Toplu ekleme — tek kilit turunda, tek yazma. */
export async function enqueueMany(
  inputs: readonly EnqueueInput[],
): Promise<{ queued: number; duplicates: number; results: EnqueueResult[] }> {
  return withLock(STORAGE_KEYS.queue, async () => {
    const now = Date.now();
    const items = await readQueue();
    const ledger = await readLedger();
    const sent = new Set(ledger.hashes);
    const inQueue = new Set(
      items.filter((item) => item.status !== "FAILED").map((item) => item.contentHash),
    );

    const results: EnqueueResult[] = [];
    const additions: QueueItem[] = [];

    for (const input of inputs) {
      if (sent.has(input.contentHash)) {
        results.push({ added: false, reason: "ALREADY_SENT", id: null });
        continue;
      }
      if (inQueue.has(input.contentHash)) {
        results.push({ added: false, reason: "DUPLICATE_IN_QUEUE", id: null });
        continue;
      }
      const item: QueueItem = {
        id: newId(),
        kind: input.kind,
        contentHash: input.contentHash,
        label: input.label,
        uyapDosyaNo: input.uyapDosyaNo,
        payload: input.payload,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      additions.push(item);
      inQueue.add(input.contentHash);
      results.push({ added: true, reason: null, id: item.id });
    }

    if (additions.length > 0) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.queue]: prune([...items, ...additions], now),
      });
    }

    const queued = results.filter((result) => result.added).length;
    return { queued, duplicates: results.length - queued, results };
  });
}

/** Gönderilmiş hash defterine ekler (kuyruk budansa bile yinelenme engellenir). */
async function rememberHash(hash: string): Promise<void> {
  await updateLocal<LedgerState>(STORAGE_KEYS.ledger, EMPTY_LEDGER, (current) => {
    if (current.hashes.includes(hash)) return current;
    const hashes = [hash, ...current.hashes].slice(0, QUEUE_CONFIG.ledgerLimit);
    return { hashes };
  });
}

/** Bu hash daha önce başarıyla gönderildi mi? */
export async function isAlreadySent(hash: string): Promise<boolean> {
  const ledger = await readLedger();
  return ledger.hashes.includes(hash);
}

async function patchItems(patches: ReadonlyMap<string, Partial<QueueItem>>): Promise<void> {
  if (patches.size === 0) return;
  await updateLocal<QueueItem[]>(STORAGE_KEYS.queue, [], (items) =>
    prune(
      items.map((item) => {
        const patch = patches.get(item.id);
        return patch ? ({ ...item, ...patch, updatedAt: Date.now() } as QueueItem) : item;
      }),
      Date.now(),
    ),
  );
}

/**
 * Service worker yeniden başladığında yarıda kalan (INFLIGHT) öğeleri geri alır.
 * At-least-once teslim: aynı öğe tekrar gönderilse bile içerik hash'i sayesinde
 * sunucu tarafında yinelenmez.
 */
export async function resetInflight(): Promise<void> {
  await updateLocal<QueueItem[]>(STORAGE_KEYS.queue, [], (items) =>
    items.map((item) =>
      item.status === "INFLIGHT" ? { ...item, status: "PENDING", updatedAt: Date.now() } : item,
    ),
  );
}

/** İşlenmeye hazır öğeleri kilit altında rezerve eder. */
async function reserveDueItems(now: number): Promise<QueueItem[]> {
  return withLock(STORAGE_KEYS.queue, async () => {
    const items = await readQueue();
    const due = items
      .filter((item) => item.status === "PENDING" && item.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, QUEUE_CONFIG.batchSize);
    if (due.length === 0) return [];
    const dueIds = new Set(due.map((item) => item.id));
    const next = items.map((item) =>
      dueIds.has(item.id) ? { ...item, status: "INFLIGHT" as const, updatedAt: now } : item,
    );
    await chrome.storage.local.set({ [STORAGE_KEYS.queue]: next });
    return due.map((item) => ({ ...item, status: "INFLIGHT" as const }));
  });
}

export interface DrainSummary {
  readonly processed: number;
  readonly done: number;
  readonly duplicates: number;
  readonly retried: number;
  readonly failed: number;
}

/**
 * Kuyruk sürücüsü: hazır öğeleri sırayla işler.
 * Ağ çağrıları kilit DIŞINDA yapılır; yalnızca durum güncellemeleri kilitlidir.
 */
export async function drain(processor: QueueProcessor, now = Date.now()): Promise<DrainSummary> {
  const due = await reserveDueItems(now);
  if (due.length === 0) {
    return { processed: 0, done: 0, duplicates: 0, retried: 0, failed: 0 };
  }

  const patches = new Map<string, Partial<QueueItem>>();
  let done = 0;
  let duplicates = 0;
  let retried = 0;
  let failed = 0;

  for (const item of due) {
    let outcome: ProcessOutcome;
    try {
      outcome = await processor(item);
    } catch (error) {
      outcome = {
        result: "RETRY",
        error: error instanceof Error ? error.message : "Bilinmeyen hata",
      };
    }

    const attempts = item.attempts + 1;
    if (outcome.result === "DONE" || outcome.result === "DUPLICATE") {
      await rememberHash(item.contentHash);
      // Gövde hemen boşaltılır: aktarımı biten evrak/veri yerelde bekletilmez (KVKK bulgu 7).
      patches.set(item.id, { status: outcome.result, attempts, lastError: null, payload: null });
      if (outcome.result === "DONE") done += 1;
      else duplicates += 1;
      continue;
    }

    if (outcome.result === "FAILED" || attempts >= QUEUE_CONFIG.maxAttempts) {
      patches.set(item.id, { status: "FAILED", attempts, lastError: outcome.error });
      failed += 1;
      continue;
    }

    patches.set(item.id, {
      status: "PENDING",
      attempts,
      lastError: outcome.error,
      nextAttemptAt: Date.now() + backoffDelayMs(attempts),
    });
    retried += 1;
  }

  await patchItems(patches);
  return { processed: due.length, done, duplicates, retried, failed };
}

/** Kuyrukta işlenmeyi bekleyen öğe var mı? */
export async function hasPendingWork(now = Date.now()): Promise<boolean> {
  const items = await readQueue();
  return items.some((item) => item.status === "PENDING" && item.nextAttemptAt <= now);
}

/** Başarısız öğeleri yeniden sıraya alır (popup'taki "Yeniden dene"). */
export async function retryFailed(): Promise<number> {
  let requeued = 0;
  await updateLocal<QueueItem[]>(STORAGE_KEYS.queue, [], (items) =>
    items.map((item) => {
      if (item.status !== "FAILED") return item;
      requeued += 1;
      return { ...item, status: "PENDING", attempts: 0, nextAttemptAt: Date.now(), lastError: null, updatedAt: Date.now() };
    }),
  );
  return requeued;
}

/** Kuyruğu temizler (gönderilmiş hash defteri KORUNUR — yinelenme koruması sürer). */
export async function clearQueue(): Promise<number> {
  let cleared = 0;
  await updateLocal<QueueItem[]>(STORAGE_KEYS.queue, [], (items) => {
    cleared = items.length;
    return [];
  });
  return cleared;
}

export async function getSnapshot(limit = 50): Promise<QueueSnapshot> {
  const items = await readQueue();
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    pending: items.filter((item) => item.status === "PENDING" || item.status === "INFLIGHT").length,
    failed: items.filter((item) => item.status === "FAILED").length,
    done: items.filter((item) => item.status === "DONE").length,
    duplicates: items.filter((item) => item.status === "DUPLICATE").length,
    items: sorted.slice(0, limit),
  };
}
