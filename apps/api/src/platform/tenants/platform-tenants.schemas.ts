import { z } from "zod";
import { SUPPORT_GRANT_DEFAULT_HOURS, SUPPORT_GRANT_MAX_HOURS } from "../platform.constants";

/** Gerekçe alanı — dört-göz ve destek erişiminde ZORUNLUDUR (spec §İş Kuralları 6). */
export const reasonField = z
  .string()
  .trim()
  .min(10, "Gerekçe en az 10 karakter olmalıdır; denetim izinde okunabilir olmalı.")
  .max(1000, "Gerekçe en fazla 1000 karakter olabilir.");

export const tenantUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Büro adı en az 2 karakter olmalıdır.")
    .max(200, "Büro adı en fazla 200 karakter olabilir.")
    .optional(),
});
export type TenantUpdateInput = z.infer<typeof tenantUpdateSchema>;

export const tenantNoteSchema = z.object({
  note: z
    .string()
    .trim()
    .max(2000, "Not en fazla 2000 karakter olabilir.")
    .nullable(),
});
export type TenantNoteInput = z.infer<typeof tenantNoteSchema>;

export const tenantStatusSchema = z.object({ reason: reasonField });

/**
 * KALICI SİLME / VERİ İMHASI — spec §Roller dört-göz listesi madde 1
 * (denetim bulgusu Ö-28). `confirmName`, talebi açanın doğru büroyu
 * hedeflediğinin kanıtıdır ve hem talep hem UYGULAMA anında doğrulanır:
 * geri alınamaz bir işlemde tek doğrulama yeterli değildir.
 */
export const tenantDeleteSchema = z.object({
  confirmName: z
    .string()
    .trim()
    .min(2, "Silmek için büronun adını birebir yazmalısınız."),
  reason: reasonField,
});
export type TenantDeleteInput = z.infer<typeof tenantDeleteSchema>;
export type TenantStatusInput = z.infer<typeof tenantStatusSchema>;

/**
 * Destek erişim penceresi talebi.
 *
 * Süre üst sınırı ŞEMADA DEĞİL burada zorlanır (Prisma `expiresAt`'i serbest
 * bırakır); azami 24 saat kuralı spec §İş Kuralları 8'dendir.
 */
export const supportAccessSchema = z.object({
  reason: reasonField,
  scope: z
    .enum(["SADECE_USTVERI", "YAPILANDIRMA", "ICERIK_MASKELI"], {
      errorMap: () => ({
        message:
          "Kapsam SADECE_USTVERI, YAPILANDIRMA veya ICERIK_MASKELI olmalıdır. " +
          "Varsayılan ve en dar kapsam SADECE_USTVERI'dir.",
      }),
    })
    .default("SADECE_USTVERI"),
  hours: z.coerce
    .number()
    .int("Süre tam saat olmalıdır.")
    .min(1, "Süre en az 1 saat olmalıdır.")
    .max(
      SUPPORT_GRANT_MAX_HOURS,
      `Destek erişimi ${SUPPORT_GRANT_MAX_HOURS} saatten uzun olamaz (KVKK — erişim minimizasyonu).`
    )
    .default(SUPPORT_GRANT_DEFAULT_HOURS),
});
export type SupportAccessInput = z.infer<typeof supportAccessSchema>;
