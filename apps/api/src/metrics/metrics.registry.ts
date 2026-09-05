/**
 * METRİK KAYDI (Faz 4) — prom-client; tek süreç geneli kayıt defteri.
 *
 * 12 iş/altyapı metriği (uyarı kuralları `prometheus/alerts.yml`):
 *   1  nomosos_http_request_duration_seconds   histogram {method,route}  → p95 gecikme
 *   2  nomosos_http_requests_total             counter   {method,route,status} → 5xx / 429 oranı
 *   3  nomosos_ai_calls_total                  counter   {outcome}       → AI başarısızlık oranı
 *   4  nomosos_ai_call_duration_seconds        histogram
 *   5  nomosos_queue_jobs                      gauge     {state}         → belge hattı kuyruk derinliği
 *   6  nomosos_ocr_duration_seconds            histogram
 *   7  nomosos_backup_last_success_timestamp_seconds gauge            → yedek tazeliği (BACKUP_STATUS_FILE)
 *   8  nomosos_credit_wallets_negative_total   gauge                   → kredi mutabakatı sapması
 *   9  nomosos_subscriptions                   gauge     {status}       → gelir sağlığı (PAST_DUE artışı)
 *  10  nomosos_platform_invoices_overdue_total gauge                   → vadesi geçmiş platform faturası
 *  11  nomosos_db_up / nomosos_db_check_duration_seconds               → veritabanı erişimi
 *  12  nomosos_scheduler_job_failures_total    counter   {job}          → zamanlanmış iş hatası
 *  + process_* / nodejs_* varsayılanları (collectDefaultMetrics).
 *
 * Etiket disiplini: rota KALIBI (`/api/v1/cases/:id`), kiracı kimliği YOK
 * (kardinalite + KVKK). Kayıt defteri modül-yüklemede kurulur; testler `resetMetrics()`.
 */

import { readFileSync } from "node:fs";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
registry.setDefaultLabels({ app: "nomosos-api" });
collectDefaultMetrics({ register: registry, prefix: "" });

export const httpDuration = new Histogram({
  name: "nomosos_http_request_duration_seconds",
  help: "HTTP istek süresi (saniye), rota kalıbına göre.",
  labelNames: ["method", "route"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});
export const httpRequests = new Counter({
  name: "nomosos_http_requests_total",
  help: "HTTP istek sayısı (yöntem, rota kalıbı, durum kodu).",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});
export const aiCalls = new Counter({
  name: "nomosos_ai_calls_total",
  help: "AI görev çağrıları (outcome: ok | provider_error | guard_reject).",
  labelNames: ["outcome"] as const,
  registers: [registry],
});
export const aiDuration = new Histogram({
  name: "nomosos_ai_call_duration_seconds",
  help: "AI sağlayıcı çağrı süresi (saniye).",
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300],
  registers: [registry],
});
export const queueJobs = new Gauge({
  name: "nomosos_queue_jobs",
  help: "Belge hattı kuyruğu iş sayısı (state: waiting | active | failed).",
  labelNames: ["state"] as const,
  registers: [registry],
});
export const ocrDuration = new Histogram({
  name: "nomosos_ocr_duration_seconds",
  help: "OCR sayfa tanıma süresi (saniye).",
  buckets: [0.5, 1, 2, 5, 10, 20, 40, 60, 120],
  registers: [registry],
});
export const backupLastSuccess = new Gauge({
  name: "nomosos_backup_last_success_timestamp_seconds",
  help: "Son başarılı yedeğin zaman damgası (Unix sn); 0 = bilinmiyor.",
  registers: [registry],
});
export const creditWalletsNegative = new Gauge({
  name: "nomosos_credit_wallets_negative_total",
  help: "Bakiyesi eksiye düşmüş kredi cüzdanı sayısı (mutabakat sapması).",
  registers: [registry],
});
export const subscriptionsByStatus = new Gauge({
  name: "nomosos_subscriptions",
  help: "Abonelik sayısı (status etiketiyle).",
  labelNames: ["status"] as const,
  registers: [registry],
});
export const platformInvoicesOverdue = new Gauge({
  name: "nomosos_platform_invoices_overdue_total",
  help: "Vadesi geçmiş, ödenmemiş platform faturası sayısı.",
  registers: [registry],
});
export const dbUp = new Gauge({ name: "nomosos_db_up", help: "Veritabanı erişimi (1=ayakta, 0=erişilemiyor).", registers: [registry] });
export const dbCheckDuration = new Gauge({ name: "nomosos_db_check_duration_seconds", help: "SELECT 1 ölçüm süresi (saniye).", registers: [registry] });
export const schedulerFailures = new Counter({
  name: "nomosos_scheduler_job_failures_total",
  help: "Zamanlanmış iş koşusu hataları (job anahtarı).",
  labelNames: ["job"] as const,
  registers: [registry],
});
export const tenantsTotal = new Gauge({ name: "nomosos_tenants_total", help: "Kayıtlı büro (kiracı) sayısı.", registers: [registry] });
export const usersActive = new Gauge({ name: "nomosos_users_active_total", help: "Aktif kullanıcı sayısı.", registers: [registry] });
export const casesOpen = new Gauge({ name: "nomosos_cases_open_total", help: "ACIK durumdaki dosya sayısı.", registers: [registry] });

export function observeHttp(method: string, route: string, status: number, durationMs: number): void {
  const m = method.toUpperCase();
  httpDuration.labels(m, route).observe(durationMs / 1000);
  httpRequests.labels(m, route, String(status)).inc();
}

export function observeAiCall(outcome: "ok" | "provider_error" | "guard_reject", durationMs: number): void {
  aiCalls.labels(outcome).inc();
  aiDuration.observe(durationMs / 1000);
}

export function observeOcr(durationMs: number): void {
  ocrDuration.observe(durationMs / 1000);
}

/**
 * Yedek durumu dosyası (`BACKUP_STATUS_FILE`, varsayılan /backups/last-success.json):
 * yedek konteyneri her başarılı koşuda `{"finishedAt":"<ISO>"}` yazar.
 */
export function readBackupTimestamp(file = process.env.BACKUP_STATUS_FILE?.trim() || "/backups/last-success.json"): number {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as { finishedAt?: string };
    const t = parsed.finishedAt ? Date.parse(parsed.finishedAt) : NaN;
    return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
  } catch {
    return 0;
  }
}

export async function renderMetrics(): Promise<string> {
  backupLastSuccess.set(readBackupTimestamp());
  return registry.metrics();
}

/** Testler için. */
export function resetMetrics(): void {
  registry.resetMetrics();
}
