import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "../../auth/auth.constants";
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

/**
 * KİRAÇI AÇMA (D5 / M2) — dört-göz TENANT_CREATE talebinin gövdesi.
 *
 * Parola talep anında HASH'lenir; payloadJson düz parola ASLA taşımaz
 * (PLATFORM_USER_CREATE ile aynı kural). İlk yönetici ADMIN rolüyle açılır.
 * Abonelik TRIAL olarak başlar; plan anahtarı yürütme anında yeniden
 * doğrulanır (silinmiş/pasif planla talep açılamaz).
 */
export const tenantCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Büro adı en az 2 karakter olmalıdır.")
    .max(200, "Büro adı en fazla 200 karakter olabilir."),
  planKey: z
    .string()
    .trim()
    .min(2, "Plan anahtarı zorunludur (örn. SOLO, BURO, ENTERPRISE).")
    .max(50, "Plan anahtarı en fazla 50 karakter olabilir."),
  seats: z.coerce
    .number()
    .int("Koltuk sayısı tam sayı olmalıdır.")
    .min(1, "Koltuk sayısı en az 1 olmalıdır.")
    .max(1000, "Koltuk sayısı en fazla 1000 olabilir.")
    .default(1),
  adminEmail: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin."),
  adminFullName: z
    .string()
    .trim()
    .min(3, "Yönetici adı en az 3 karakter olmalıdır.")
    .max(200, "Yönetici adı en fazla 200 karakter olabilir."),
  password: z
    .string()
    .min(10, "Parola en az 10 karakter olmalıdır.")
    .max(PASSWORD_MAX_LENGTH, `Parola en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.`),
  reason: reasonField,
});
export type TenantCreateInput = z.infer<typeof tenantCreateSchema>;
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
