/**
 * Gün-hassasiyetli tarih aritmetiği.
 *
 * SAAT DİLİMİ SÖZLEŞMESİ (kritik):
 * Bu paketteki bütün tarihler "takvim günü" değeridir; saat/dakika taşımaz.
 * Her giriş, tarihin **UTC gün bileşenlerine** göre yorumlanır ve çıktı daima
 * ilgili günün UTC gün başıdır (`00:00:00.000Z`). Bu sayede sunucunun/işletim
 * sisteminin yerel saat dilimi ne olursa olsun sonuç aynıdır — hukuki hesapta
 * makineye göre değişen sonuç kabul edilemez.
 *
 * Doğru girdi üretmek için: `parseDateOnly("2026-08-18")`, `dateOnly(2026, 8, 18)`
 * veya doğrudan Prisma'dan gelen `DateTime` (UTC tabanlıdır) kullanın.
 * `new Date(2026, 7, 18)` (yerel saatli kurucu) UTC+3'te bir gün geriye kayar; kullanmayın.
 */

const MS_PER_DAY = 86_400_000;

const TR_WEEKDAYS = [
  "Pazar",
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
] as const;

const TR_MONTHS = [
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

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

/** `Date` nesnesinin geçerli olup olmadığını denetler. */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * `"YYYY-MM-DD"` (veya ISO tarih-saat) metnini UTC gün başına çevirir.
 * @throws Geçersiz biçimde.
 */
export function parseDateOnly(value: string): Date {
  const m = ISO_DATE_RE.exec(value.trim());
  if (!m) {
    throw new Error(`Geçersiz tarih biçimi: "${value}". Beklenen biçim: YYYY-MM-DD.`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) {
    throw new Error(`Geçersiz ay değeri: ${month} ("${value}").`);
  }
  const result = new Date(Date.UTC(year, month - 1, day));
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) {
    throw new Error(`Takvimde bulunmayan tarih: "${value}".`);
  }
  return result;
}

/**
 * Takvim gününden UTC gün başı üretir.
 * @param month 1 tabanlı ay (1 = Ocak).
 */
export function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Herhangi bir `Date | string` değerini UTC gün başına normalize eder.
 * Saat bileşeni sıfırlanır; gün, ay ve yıl UTC'ye göre okunur.
 */
export function toUtcDate(value: Date | string): Date {
  if (typeof value === "string") return parseDateOnly(value);
  if (!isValidDate(value)) {
    throw new Error("Geçersiz tarih değeri (Invalid Date).");
  }
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** Verilen ayın gün sayısı. @param month 1 tabanlı ay. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Gün ekler (negatif değer geriye alır). */
export function addDays(date: Date, days: number): Date {
  return new Date(toUtcDate(date).getTime() + days * MS_PER_DAY);
}

/**
 * Ay ekler. Hedef ayda karşılık gelen gün yoksa **ayın son gününe** sabitlenir
 * (HMK m.92/2: "…ayın son günü tatil saatinde biter").
 * Örn. 31 Ocak + 1 ay → 28/29 Şubat.
 */
export function addMonths(date: Date, months: number): Date {
  const base = toUtcDate(date);
  const day = base.getUTCDate();
  const firstOfTarget = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const targetYear = firstOfTarget.getUTCFullYear();
  const targetMonth = firstOfTarget.getUTCMonth() + 1; // 1 tabanlı
  const last = daysInMonth(targetYear, targetMonth);
  return dateOnly(targetYear, targetMonth, Math.min(day, last));
}

/** Yıl ekler. 29 Şubat + 1 yıl → 28 Şubat (artık olmayan yılda son güne sabitlenir). */
export function addYears(date: Date, years: number): Date {
  return addMonths(date, years * 12);
}

/** İki tarih arasındaki tam gün farkı (b - a). */
export function diffDays(a: Date, b: Date): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / MS_PER_DAY);
}

/** Aynı takvim günü mü. */
export function isSameDay(a: Date, b: Date): boolean {
  return toUtcDate(a).getTime() === toUtcDate(b).getTime();
}

/** Cumartesi veya Pazar mı (UTC gününe göre). */
export function isWeekend(date: Date): boolean {
  const day = toUtcDate(date).getUTCDay();
  return day === 0 || day === 6;
}

/** `"YYYY-MM-DD"` anahtarı — tatil indeksleme ve karşılaştırma için. */
export function toIsoDateKey(date: Date | string): string {
  const d = toUtcDate(date);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Türkçe kısa biçim: `18.08.2026`. */
export function formatTrDate(date: Date): string {
  const d = toUtcDate(date);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getUTCFullYear()}`;
}

/** Türkçe uzun biçim: `18 Ağustos 2026 Salı`. */
export function formatTrDateLong(date: Date): string {
  const d = toUtcDate(date);
  return `${d.getUTCDate()} ${TR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${trWeekdayName(d)}`;
}

/** Türkçe gün adı. */
export function trWeekdayName(date: Date): string {
  return TR_WEEKDAYS[toUtcDate(date).getUTCDay()];
}

/** Türkçe ay adı. @param month 1 tabanlı. */
export function trMonthName(month: number): string {
  return TR_MONTHS[month - 1];
}
