/**
 * Rapor hücresi biçimlendirme ve sıralama.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BURADA HESAP YOK, YALNIZCA GÖSTERİM VAR.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Para değerleri sunucudan Decimal(18,2) STRING olarak gelir ve `fmtAmount`
 * ile kuruş tamsayısı üzerinden basılır — `Number()` ile kayan noktaya
 * çevrilmez. Sıralama da aynı kuruş tamsayısıyla yapılır: "9.900,00 ₺" ile
 * "10.100,00 ₺" metin olarak karşılaştırılsaydı yanlış sıralanırdı.
 */

import { fmtAmount, toKurus } from "@/lib/money";
import {
  fmtCount,
  fmtDate,
  fmtMinutes,
  fmtPercentValue,
  isNumericColumnType,
  type ReportColumnType,
} from "@/lib/labels";
import type { ReportColumn, ReportRow } from "./faz6-types";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Hücre değerini sütun tipine göre tr-TR biçiminde basar.
 *
 * PARA BİRİMİ UYDURULMAZ (denetim bulgusu 10). Sütunun sabit bir `currency`si
 * yoksa ve satırın birimini taşıyan hücre (`currencyKey`) de bilinmiyorsa
 * SEMBOL BASILMAZ. Eskiden her para hücresi `currency ?? "TRY"` ile ₺ alıyordu:
 * yaşlandırma matrisinde "Para birimi: USD" yazan satırın tutarı ekranda
 * "120.000,00 ₺" görünüyordu — okuyan ortak 120 bin TL alacak sanıyor, gerçek
 * karşılık ~4,2 milyon TL oluyordu.
 *
 * SAYI SÜTUNU ONDALIĞINI KORUR (denetim bulgusu 11). Builder'lar bu tipte
 * ondalıklı değer üretir (`calismaSaat`, `cagriBasinaKredi`,
 * `ortalamaTamamlamaPayi`); sıfır ondalıkla basmak 7,5 saati "8" yapıyor ve
 * aynı hücreyi "7,5" yazan CSV ile ekranı ayrıştırıyordu. 0,4 günlük ortalama
 * tamamlama payı "0" görünüp "pay yok" diye okunuyordu.
 */
export function formatValue(
  value: unknown,
  type: ReportColumnType,
  currency?: string | null,
): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "PARA":
      return currency ? fmtAmount(value as string | number, currency) : fmtAmountNoSymbol(value);
    case "YUZDE":
      return fmtPercentValue(asNumber(value));
    case "SAYI": {
      const n = asNumber(value);
      return fmtCount(n, n !== null && Number.isInteger(n) ? 0 : 2);
    }
    case "SURE_DK":
      return fmtMinutes(asNumber(value));
    case "TARIH":
      return fmtDate(String(value));
    default:
      return String(value);
  }
}

/**
 * Para birimi BİLİNMEYEN tutar: kuruş doğruluğu korunur, sembol basılmaz.
 * `fmtAmount` daima bir sembol ister; bilinmeyen birimi ₺ ile doldurmak
 * yanlış bilgi üretir, bu yüzden ayrı bir yol vardır.
 */
function fmtAmountNoSymbol(value: unknown): string {
  const kurus = toKurus(value as string | number);
  if (kurus === null) return String(value);
  const negative = kurus < 0n;
  const abs = negative ? -kurus : kurus;
  const major = abs / 100n;
  const minor = abs % 100n;
  const body = `${major.toLocaleString("tr-TR")},${String(minor).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/**
 * Fark değerini basar. İŞARET YAZILMAZ — yönü ok simgesi taşır, mutlak
 * büyüklüğü bu metin. İkisini birden yazmak ("↑ +12") gereksiz tekrardır.
 */
export function formatDelta(
  delta: number | null | undefined,
  type: ReportColumnType,
  currency?: string | null,
): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "—";
  const abs = Math.abs(delta);
  switch (type) {
    case "PARA":
      return fmtAmount(abs.toFixed(2), currency ?? "TRY");
    case "YUZDE":
      return fmtPercentValue(abs);
    case "SURE_DK":
      return fmtMinutes(abs);
    default:
      return fmtCount(abs, Number.isInteger(abs) ? 0 : 2);
  }
}

/** Bir sütunun sıralama anahtarı — sayısal tipler kuruş/sayı, metin harf sırası. */
function sortKey(value: unknown, type: ReportColumnType): number | string | null {
  if (value === null || value === undefined || value === "") return null;
  if (type === "PARA") {
    const k = toKurus(value as string | number);
    return k === null ? null : Number(k);
  }
  if (isNumericColumnType(type)) return asNumber(value);
  if (type === "TARIH") return String(value);
  return String(value);
}

/**
 * Satırları sıralar. BOŞ DEĞERLER HER ZAMAN SONDA kalır (yön ne olursa olsun):
 * "veri yok" bir uç değer değildir ve listeyi başında karşılamamalıdır.
 */
export function sortRows(
  rows: ReportRow[],
  column: ReportColumn | null,
  descending: boolean,
): ReportRow[] {
  if (!column) return rows;
  const collator = new Intl.Collator("tr-TR", { numeric: true, sensitivity: "base" });
  return [...rows].sort((a, b) => {
    const ka = sortKey(a[column.key], column.type);
    const kb = sortKey(b[column.key], column.type);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    let cmp: number;
    if (typeof ka === "number" && typeof kb === "number") cmp = ka - kb;
    else cmp = collator.compare(String(ka), String(kb));
    return descending ? -cmp : cmp;
  });
}

/** Dosya adı: "buro-aylik-ozet_2026-08-01_2026-08-31.csv" */
export function csvFileName(reportKey: string, from?: string, to?: string): string {
  const parts = [reportKey, from, to].filter(Boolean);
  return `${parts.join("_")}.csv`;
}
