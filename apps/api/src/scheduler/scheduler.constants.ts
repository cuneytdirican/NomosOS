/**
 * ZAMANLANMIŞ İŞ ALTYAPISI SABİTLERİ — docs/06-yol-haritasi.md (Faz 6).
 *
 * Bu modül üç ayrı yüzey sunar ve üçü de birbirinden bağımsız çalışır:
 *
 *   1. ZAMANLAYICI  — BullMQ + Redis. Redis YOKSA devre dışı kalır, API açılır.
 *   2. PLATFORM UÇLARI (/api/admin/v1/jobs) — Redis'ten BAĞIMSIZDIR; elle
 *      tetikleme süreç içinde çalışır, kuyruğa ihtiyaç duymaz.
 *   3. KİRACI UÇLARI (/api/v1/notifications, /device-tokens) — tamamen
 *      veritabanı üstünde çalışır; Redis'e hiç dokunmaz.
 *
 * Bu ayrım bilinçlidir: bildirim OKUMA yolu, zamanlayıcı altyapısının
 * ayakta olmasına bağlı olmamalıdır.
 */

/** BullMQ kuyruk adı. Tek kuyruk, iş ayrımı `job.name` (= iş anahtarı) ile. */
export const SCHEDULER_QUEUE_NAME = "nomosos-zamanlanmis-isler";

/**
 * ZAMANLAYICI SAAT DİLİMİ.
 *
 * Cron ifadeleri TÜRKİYE YEREL SAATİYLE yorumlanır: "0 7 * * *" avukatın
 * sabah 07:00'ıdır, UTC 07:00 değil. Sunucunun `process.env.TZ` değeri ne
 * olursa olsun sonuç aynıdır — hem BullMQ'ya bu değer verilir hem de
 * `cron-expression.ts` aynı ofseti kullanır.
 *
 * Türkiye 2016'dan beri yaz saati uygulamaz; ofset SABİT +03:00'tür
 * (bkz. `common/dates.ts` § TR_UTC_OFFSET_MS). Bu yüzden sabit ofsetli hesap
 * ile IANA veritabanı aynı sonucu verir ve ikisi ayrışamaz.
 */
export const SCHEDULER_TIMEZONE = "Europe/Istanbul";

/** `SCHEDULER_TIMEZONE`in sabit ofseti (dakika). */
export const SCHEDULER_TZ_OFFSET_MINUTES = 180;

/** Kod tarafındaki değişmez iş anahtarları — `ScheduledJob.key` ile birebir. */
export const JOB_KEYS = {
  USAGE_SNAPSHOT: "usage-snapshot-daily",
  DEADLINE_REMINDER: "deadline-reminder-daily",
  HEARING_REMINDER: "hearing-reminder-daily",
  SUBSCRIPTION_RENEWAL: "subscription-renewal-daily",
  CREDIT_PERIOD_RENEWAL: "credit-period-renewal-daily",
  /** denetim bulgusu Ö-29 — %80 kredi uyarısı. Saatlik: 402 sürpriz olmamalı. */
  CREDIT_LOW_WARNING: "credit-low-warning-hourly",
} as const;

export type JobKey = (typeof JOB_KEYS)[keyof typeof JOB_KEYS];

/** Redis canlılık yoklamasının üst sınırı (ms). Aşılırsa zamanlayıcı kapanır. */
export const REDIS_PROBE_TIMEOUT_MS = 3000;

/**
 * BullMQ worker kilit süresi (ms).
 *
 * VARSAYILAN (30 sn) YETERSİZDİR: gece işleri bütün kiracıları ve tablo
 * taramalarını dolaşır; yüzlerce bürolu bir kurulumda süre işi dakikalar
 * sürebilir. Kilit süresi aşılırsa BullMQ işi "stalled" sayıp yeniden dağıtır
 * ve aynı iş ikinci kez başlar. On beş dakika, en yavaş gece işi için bile
 * geniş; bir gerçek takılmayı da makul sürede açığa çıkarır.
 */
export const WORKER_LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * CRON SAATİNE KISIT YOKTUR — GEREKÇESİ `platform-jobs.schemas.ts` içindedir.
 *
 * Özeti: gün bazlı işlerin "bugün" tanımı artık TR takvim günüdür
 * (`common/dates.ts` → `trCalendarDay`), dolayısıyla cron'un TR saati ile
 * pencerelerin takvimi AYNI takvimdedir ve gece saatlerinde kayma riski
 * kalmamıştır. Sıklık kısıtı (dakika alanı sabit olmalı) yerindedir.
 */

/**
 * GEÇMİŞ SÜRE HATIRLATMASI GERİYE BAKIŞ PENCERESİ (gün).
 *
 * Sınır olmasaydı, sistemin ilk kez ayağa kalktığı gün yıllar öncesine ait
 * bütün kaçırılmış süreler için bildirim üretilir ve kullanıcı ilk sabahında
 * yüzlerce bildirimle karşılaşırdı. Eski kaçırmalar süre listesinde zaten
 * görünür; bildirim TAZE olayı taşımak içindir.
 */
export const OVERDUE_LOOKBACK_DAYS = 30;

/** Yaklaşan süre hatırlatma pencereleri (kalan gün). */
export const DEADLINE_REMINDER_WINDOWS = [7, 3, 1] as const;

/**
 * PAST_DUE aboneliğin askıya alma ÖNERİSİNE dönüşmesi için geçmesi gereken
 * gün sayısı. ÖNERİDİR — askıya alma dört-göz onayına tabidir, zamanlanmış iş
 * hiçbir koşulda kendiliğinden askıya ALMAZ.
 */
export const SUBSCRIPTION_GRACE_DAYS = 14;

/** "Yaklaşan yenileme" olarak raporlanacak ileri pencere (gün). */
export const SUBSCRIPTION_UPCOMING_DAYS = 7;

/** Bildirim listesi varsayılan sayfa boyu. */
export const NOTIFICATION_PAGE_SIZE = 30;

/** `JobRun` listesi varsayılan sayfa boyu. */
export const JOB_RUN_PAGE_SIZE = 25;

/** Platform denetim izi işlem adları. */
export const JOB_AUDIT_ACTIONS = {
  MANUAL_RUN: "JOB_MANUAL_RUN",
  PATCH: "JOB_DEFINITION_UPDATE",
  AUTO_PAST_DUE: "SUBSCRIPTION_AUTO_PAST_DUE",
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export { MS_PER_DAY };
