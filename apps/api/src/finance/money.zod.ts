/**
 * PARASAL ALANLARIN ZOD SÖZLEŞMESİ.
 *
 * Tutarlar API sınırında **STRING** olarak alınır ve string olarak Decimal'e
 * verilir. Neden: `z.coerce.number()` gövdedeki "12345678901234.56" değerini
 * IEEE-754 double'a çevirip kuruş kaybettirir; JSON'un kendisi de büyük
 * sayılarda kayıp verir. İstemci sayı gönderirse kabul edilir ama önce
 * `String(v)` ile metne çevrilip aynı doğrulamadan geçer.
 *
 * Kabul biçimi: en fazla 16 tam basamak + en fazla 2 ondalık ("40000",
 * "40000.5", "40000,50"). Virgül noktaya normalize edilir.
 */

import { z } from "zod";

const MONEY_PATTERN = /^\d{1,16}(?:[.,]\d{1,2})?$/;
const ZERO_PATTERN = /^0+(?:[.,]0{1,2})?$/;
const PERCENT_PATTERN = /^\d{1,3}(?:[.,]\d{1,2})?$/;

const toRawString = (value: unknown): unknown => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return value;
};

const normalizeDecimalSeparator = (value: string): string => value.replace(",", ".");

/** Sıfırdan büyük tutar (tahsilat, fatura satırı, sözleşme bedeli). */
export const positiveMoney = (label: string) =>
  z.preprocess(
    toRawString,
    z
      .string({ required_error: `${label} zorunludur.`, invalid_type_error: `${label} sayısal bir tutar olmalıdır.` })
      .regex(MONEY_PATTERN, `${label} en fazla iki ondalık basamaklı pozitif bir tutar olmalıdır (örn. 40000.00).`)
      .refine((v) => !ZERO_PATTERN.test(v), `${label} sıfırdan büyük olmalıdır.`)
      .transform(normalizeDecimalSeparator),
  );

/** Sıfır kabul eden tutar (indirim, açılış bakiyesi). */
export const nonNegativeMoney = (label: string) =>
  z.preprocess(
    toRawString,
    z
      .string({ required_error: `${label} zorunludur.` })
      .regex(MONEY_PATTERN, `${label} en fazla iki ondalık basamaklı bir tutar olmalıdır.`)
      .transform(normalizeDecimalSeparator),
  );

/** Opsiyonel/temizlenebilir tutar alanı (null gönderilirse alan boşaltılır). */
export const nullableMoney = (label: string) =>
  z.preprocess(
    (v) => (v === null ? null : toRawString(v)),
    z
      .string()
      .regex(MONEY_PATTERN, `${label} en fazla iki ondalık basamaklı bir tutar olmalıdır.`)
      .transform(normalizeDecimalSeparator)
      .nullable()
      .optional(),
  );

/** Yüzde alanı (KDV oranı, başarı primi): 0-100 arası, iki ondalık. */
export const percentRate = (label: string) =>
  z.preprocess(
    toRawString,
    z
      .string({ required_error: `${label} zorunludur.` })
      .regex(PERCENT_PATTERN, `${label} 0 ile 100 arasında, en fazla iki ondalık basamaklı olmalıdır.`)
      .transform(normalizeDecimalSeparator)
      .refine((v) => Number(v) <= 100, `${label} %100'den büyük olamaz.`),
  );

export const nullablePercentRate = (label: string) =>
  z.preprocess(
    (v) => (v === null ? null : toRawString(v)),
    z
      .string()
      .regex(PERCENT_PATTERN, `${label} 0 ile 100 arasında, en fazla iki ondalık basamaklı olmalıdır.`)
      .transform(normalizeDecimalSeparator)
      .refine((v) => Number(v) <= 100, `${label} %100'den büyük olamaz.`)
      .nullable()
      .optional(),
  );

/** Miktar alanı (fatura satırı adet/saat) — Decimal(12,2). */
export const quantityValue = (label: string) =>
  z.preprocess(
    toRawString,
    z
      .string({ required_error: `${label} zorunludur.` })
      .regex(/^\d{1,10}(?:[.,]\d{1,2})?$/, `${label} en fazla iki ondalık basamaklı pozitif bir sayı olmalıdır.`)
      .refine((v) => !ZERO_PATTERN.test(v), `${label} sıfırdan büyük olmalıdır.`)
      .transform(normalizeDecimalSeparator),
  );

/** ISO 4217 para birimi kodu. */
export const currencyCode = () =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z
      .string()
      .regex(/^[A-Z]{3}$/, "Para birimi üç harfli ISO kodu olmalıdır (örn. TRY, USD, EUR).")
      .default("TRY"),
  );
