/**
 * tr-TR tarih/saat biçimlendirme — Intl KULLANILMAZ.
 *
 * NEDEN ELLE: Hermes'in Intl desteği platforma ve sürüme göre değişir; bir
 * Android cihazda "31 Ağustos 2026", diğerinde "August 31, 2026" görmek bir
 * hukuk uygulamasında kabul edilemez. Biçimler burada sabittir.
 *
 * ---------------------------------------------------------------------------
 * İKİ TARİH SÖZLEŞMESİ — KARIŞTIRILMAMALI (proje kararı: "UTC gün bazı")
 * ---------------------------------------------------------------------------
 * 1. GÜN BAZLI alanlar (Deadline.dueDate — şemada `@db.Date`): sunucu UTC gün
 *    başı üretir. Bunlar UTC bileşenleriyle okunur (`formatDay`). Cihazın saat
 *    dilimi ne olursa olsun "5 Eylül" 5 Eylül kalır.
 * 2. ZAMAN DAMGALI alanlar (Hearing.date, createdAt): gerçek bir ana işaret
 *    eder, cihazın YEREL saatiyle gösterilir (`formatDateTime`, `formatTime`).
 *    Duruşma saati avukatın bulunduğu yerin saatidir.
 *
 * Yanlış aileyi seçmek gün kaymasına yol açar; her fonksiyonun adı hangi
 * aileye ait olduğunu söyler.
 */

const MONTHS_TR = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

const WEEKDAYS_TR = [
  "Pazar",
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
] as const;

const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthName(index: number): string {
  return MONTHS_TR[index] ?? "";
}

function weekdayName(index: number): string {
  return WEEKDAYS_TR[index] ?? "";
}

// ---------------------------------------------------------------------------
// GÜN BAZLI (UTC bileşenleri) — Deadline.dueDate ve benzeri `@db.Date` alanlar
// ---------------------------------------------------------------------------

/** "05.09.2026" — gün bazlı alan. */
export function formatDay(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

/** "5 Eylül 2026 Cumartesi" — gün bazlı alan, uzun biçim. */
export function formatDayLong(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${date.getUTCDate()} ${monthName(date.getUTCMonth())} ${date.getUTCFullYear()} ${weekdayName(
    date.getUTCDay(),
  )}`;
}

/** Gün bazlı alanın UTC takvim gününü sayıya çevirir (gün karşılaştırması için). */
function utcDayNumber(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY;
}

/** Cihazın YEREL takvim gününü aynı ölçeğe çevirir. */
function localTodayNumber(now: Date = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY;
}

/**
 * Gün bazlı bir tarihe kalan gün sayısı.
 *
 * Sunucunun UTC takvim günü ile cihazın YEREL takvim günü karşılaştırılır:
 * kullanıcı için "bugün", takvimde gördüğü gündür. 0 = bugün, negatif = geçmiş.
 */
export function daysUntil(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  const date = toDate(value);
  if (!date) return null;
  return utcDayNumber(date) - localTodayNumber(now);
}

/** "Bugün" / "Yarın" / "3 gün kaldı" / "2 gün gecikti". */
export function remainingLabel(value: string | Date | null | undefined, now: Date = new Date()): string {
  const days = daysUntil(value, now);
  if (days === null) return "—";
  if (days === 0) return "Bugün";
  if (days === 1) return "Yarın";
  if (days === -1) return "Dün — gecikti";
  if (days > 1) return `${days} gün kaldı`;
  return `${Math.abs(days)} gün gecikti`;
}

// ---------------------------------------------------------------------------
// ZAMAN DAMGALI (yerel bileşenler) — Hearing.date, createdAt, sentAt …
// ---------------------------------------------------------------------------

/** "09:30" — yerel saat. */
export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "31.08.2026" — zaman damgalı alanın yerel günü. */
export function formatLocalDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** "31.08.2026 09:30" — yerel. */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${formatLocalDate(date)} ${formatTime(date)}`;
}

/** "31 Ağustos 2026 Pazartesi" — yerel, uzun biçim. */
export function formatLocalDateLong(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${date.getDate()} ${monthName(date.getMonth())} ${date.getFullYear()} ${weekdayName(date.getDay())}`;
}

/** Sunucu sorgusu için cihazın yerel takvim günü: "2026-08-31". */
export function localDateParam(offsetDays = 0, now: Date = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Zaman damgalı bir alanın yerel günü bugün mü? */
export function isLocalToday(value: string | Date | null | undefined, now: Date = new Date()): boolean {
  const date = toDate(value);
  if (!date) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** Para — sunucu Decimal'ı metin olarak yollar; mobilde SADECE GÖSTERİLİR, hesaplanmaz. */
export function formatMoney(value: string | number | null | undefined, currency = "TRY"): string {
  if (value === null || value === undefined || value === "") return "—";
  const raw = typeof value === "number" ? value.toFixed(2) : String(value);
  const negative = raw.trim().startsWith("-");
  const [intPartRaw = "0", fracRaw = ""] = raw.replace("-", "").trim().split(".");
  const frac = (fracRaw + "00").slice(0, 2);
  const grouped = intPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const symbol = currency === "TRY" ? "₺" : `${currency} `;
  return `${negative ? "-" : ""}${symbol}${grouped},${frac}`;
}
