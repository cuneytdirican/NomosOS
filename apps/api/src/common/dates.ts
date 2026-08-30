import { BadRequestException } from "@nestjs/common";

/**
 * API tarafı gün aritmetiği.
 *
 * SÖZLEŞME: Tüm gün sınırları UTC gün bileşenleri üzerinden hesaplanır —
 * `@nomosos/legal-core/date-utils` ile aynı sözleşme.
 *
 * Eskiden `setHours` (yerel saat) kullanılıyordu; süre motoru `dueDate`'i daima
 * UTC gün başı olarak ürettiği için sunucu UTC+3'te çalışırken sonuç doğru
 * çıkıyor, ancak negatif ofsetli bir bölgede veya `TZ=UTC` bir container'da
 * "gecikmiş" karşılaştırmaları bir gün kayıyordu (denetim bulgusu 16).
 * Sonuç artık `process.env.TZ` varsayımına bağlı DEĞİLDİR.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ISO tarih dizesini Date'e çevirir; geçersizse Türkçe 400 fırlatır. */
export function parseDateParam(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Geçersiz tarih (${label}). ISO biçimi bekleniyor, örn. 2026-08-30.`);
  }
  return date;
}

/**
 * Aralık sonu (`to`) parametresi için GÜN SONU sınırı üretir.
 *
 * `to=2026-09-06` `2026-09-06T00:00:00.000Z` olarak ayrıştırılıp `lte` süzgecine
 * verildiğinde, saat bileşeni taşıyan kayıtlar (ör. Pazar 09:30 duruşması)
 * sonuçtan düşüyordu — haftalık takvimin son günü hep boş görünüyordu
 * (denetim bulgusu 10).
 */
export function parseRangeEnd(value: string, label: string): Date {
  return endOfDay(parseDateParam(value, label));
}

/** UTC gün başı (00:00:00.000Z). */
export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** UTC gün sonu (23:59:59.999Z). */
export function endOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function addYears(date: Date, years: number): Date {
  const copy = new Date(date);
  copy.setUTCFullYear(copy.getUTCFullYear() + years);
  return copy;
}

/** Haftanın ilk günü Pazartesi (TR takvim alışkanlığı), UTC gün başı. */
export function startOfWeek(date: Date): Date {
  const copy = startOfDay(date);
  const day = copy.getUTCDay(); // 0 = Pazar
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(copy, diff);
}

/** Haftanın son günü (Pazar) gün sonu. */
export function endOfWeek(date: Date): Date {
  return endOfDay(addDays(startOfWeek(date), 6));
}

/** 30.08.2026 biçimi — hesap izi metinlerinde kullanılır. */
export function formatTrDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}.${m}.${date.getUTCFullYear()}`;
}
