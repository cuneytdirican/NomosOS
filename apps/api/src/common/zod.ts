import { z } from "zod";

/** Boş/whitespace metni null'a çevirir — form alanı temizleme davranışı. */
const emptyToNull = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? null : value;

/** Opsiyonel + temizlenebilir metin alanı (null gönderilirse alan boşaltılır). */
export const nullableText = (max: number, label: string) =>
  z.preprocess(
    emptyToNull,
    z
      .string()
      .max(max, `${label} en fazla ${max} karakter olabilir.`)
      .nullable()
      .optional()
  );

/** Opsiyonel + temizlenebilir e-posta alanı. */
export const nullableEmail = () =>
  z.preprocess(
    emptyToNull,
    z.string().email("Geçerli bir e-posta adresi giriniz.").nullable().optional()
  );

/** Opsiyonel + temizlenebilir UUID alanı (ilişki kaldırma için null kabul eder). */
export const nullableUuid = (label: string) =>
  z.preprocess(
    emptyToNull,
    z.string().uuid(`${label} geçerli bir kayıt kimliği olmalıdır.`).nullable().optional()
  );

/** Opsiyonel + temizlenebilir tarih alanı. */
export const nullableDate = (label: string) =>
  z.preprocess(
    emptyToNull,
    z.coerce.date({ invalid_type_error: `${label} geçerli bir tarih olmalıdır.` }).nullable().optional()
  );
