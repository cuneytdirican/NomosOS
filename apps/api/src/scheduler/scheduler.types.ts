import type { JobStatus } from "@nomosos/db";

/** İşi neyin tetiklediği. Denetim ve günlük okunurluğu içindir. */
export type JobTrigger = "cron" | "manuel" | "acilis";

export interface JobExecutionContext {
  trigger: JobTrigger;
  /**
   * Referans an. Testlerde SABİTLENİR; iş içinde `new Date()` çağırmak
   * "gece yarısını geçerken farklı gün" hatalarına ve test kırılganlığına
   * yol açar — tek zaman kaynağı buradadır.
   */
  now: Date;
  /** Elle tetiklemede hedef gün (yalnız gün bazlı işler dikkate alır). */
  targetDate?: Date;
  /** Elle tetikleyen platform kullanıcısının kimliği (denetim izi). */
  triggeredBy?: string;
}

/**
 * İş sonucu.
 *
 * ÜÇ SAYI AYRI TUTULUR ÇÜNKÜ ANLAMLARI AYRIDIR:
 *   created — yeni ÜRETİLEN kayıt. İdempotentlik ölçüsü: aynı işin ikinci
 *             koşusunda 0 OLMALIDIR.
 *   skipped — idempotentlik nedeniyle atlanan (zaten var olan) kayıt.
 *             HATA DEĞİLDİR; sistemin doğru çalıştığının kanıtıdır.
 *   failed  — gerçekten başarısız olan kayıt. Tek satırın patlaması işin
 *             tamamını durdurmaz; sayılır ve iş BAŞARISIZ işaretlenir.
 */
export interface JobResult {
  created: number;
  skipped: number;
  failed: number;
  /** `JobRun.detailJson` içine yazılacak serbest kırılım. */
  detail?: Record<string, unknown>;
  /** İlk birkaç hata metni — `JobRun.errorMessage` için. */
  errors?: string[];
}

export function emptyResult(): JobResult {
  return { created: 0, skipped: 0, failed: 0 };
}

export interface ScheduledJobHandler {
  readonly key: string;
  /** `ScheduledJob.name` — tanım tabloda yoksa açılışta bu adla üretilir. */
  readonly name: string;
  readonly defaultCron: string;
  /** Panelde gösterilecek tek cümlelik açıklama (kod TEK KAYNAKTIR). */
  readonly description: string;
  run(ctx: JobExecutionContext): Promise<JobResult>;
}

/**
 * SONUÇ → DURUM eşlemesi.
 *
 * `ATLANDI`nın anlamı şemada tanımlıdır: "iş çalıştı ama idempotentlik gereği
 * yapacak bir şey bulamadı". Yani ikinci koşu BAŞARISIZ değil ATLANDI'dır;
 * bu ayrım olmadan panelde her gece "aynı iş iki kez başarılı" görünür ve
 * gerçek bir çift yazım fark edilemezdi.
 *
 * Hiç iş çıkmayan gün (0 süre, 0 duruşma) BAŞARILI'dır — atlanacak bir şey de
 * yoktur; "ATLANDI" orada yanıltıcı olurdu.
 */
export function resolveJobStatus(result: JobResult): JobStatus {
  if (result.failed > 0) return "BASARISIZ";
  if (result.created > 0) return "BASARILI";
  if (result.skipped > 0) return "ATLANDI";
  return "BASARILI";
}

/** Bir iş koşusunun panele dönen özeti. */
export interface JobRunSummary {
  jobRunId: string;
  jobKey: string;
  status: JobStatus;
  trigger: JobTrigger;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  itemsProcessed: number;
  skipped: number;
  failed: number;
  errorMessage: string | null;
  detail: Record<string, unknown> | null;
}
