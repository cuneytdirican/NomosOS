import { z } from "zod";
import { reasonField } from "../tenants/platform-tenants.schemas";

/**
 * PARA ALANLARI STRING OLARAK ALINIR.
 *
 * `z.number()` kullanmak fiyatı IEEE-754 çift duyarlıklı float'a sokar ve
 * 1200.10 gibi değerler kuruş kaybeder. Değer düzenli ifadeyle doğrulanır ve
 * Prisma'ya STRING olarak verilir; Decimal dönüşümünü veritabanı yapar
 * (ortak teknik karar 1).
 */
const decimalString = (label: string, maxIntDigits = 16) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^\\d{1,${maxIntDigits}}(\\.\\d{1,2})?$`),
      `${label} en fazla 2 ondalık haneli pozitif bir sayı olmalıdır (örn. "1200.00").`
    );

export const planUpsertSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,32}$/, "Plan anahtarı 2-32 karakter, yalnız A-Z, 0-9 ve _ olabilir."),
  name: z.string().trim().min(2, "Plan adı zorunludur.").max(100),
  monthlyPricePerUser: decimalString("Kullanıcı başına aylık fiyat").nullable().optional(),
  maxUsers: z.coerce
    .number()
    .int()
    .positive("Kullanıcı üst sınırı pozitif olmalıdır.")
    .nullable()
    .optional(),
  /** { aiCallQuota, storageGb, modules[] } gibi serbest bayraklar. */
  features: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
  /**
   * denetim bulgusu K-11: plan oluşturma DÖRT-GÖZ onayına tabidir; onay
   * kuyruğundaki her talep gibi gerekçe taşımak zorundadır.
   */
  reason: reasonField,
});
export type PlanUpsertInput = z.infer<typeof planUpsertSchema>;

export const planPatchSchema = planUpsertSchema.partial().omit({ key: true });
export type PlanPatchInput = z.infer<typeof planPatchSchema>;

export const subscriptionChangeSchema = z
  .object({
    planKey: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{2,32}$/, "Plan anahtarı geçersiz.")
      .optional(),
    seats: z.coerce
      .number()
      .int("Koltuk sayısı tam sayı olmalıdır.")
      .min(1, "Koltuk sayısı en az 1 olmalıdır.")
      .max(10000, "Koltuk sayısı 10.000'i aşamaz.")
      .optional(),
    reason: reasonField,
  })
  .refine((v) => v.planKey !== undefined || v.seats !== undefined, {
    message: "Plan ya da koltuk sayısından en az biri değiştirilmelidir.",
  });
export type SubscriptionChangeInput = z.infer<typeof subscriptionChangeSchema>;

export const subscriptionTransitionSchema = z.object({
  to: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"], {
    errorMap: () => ({
      message: "Hedef durum TRIAL, ACTIVE, PAST_DUE, SUSPENDED veya CANCELED olmalıdır.",
    }),
  }),
  reason: reasonField,
});
export type SubscriptionTransitionInput = z.infer<typeof subscriptionTransitionSchema>;

export const subscriptionCancelSchema = z.object({ reason: reasonField });
export type SubscriptionCancelInput = z.infer<typeof subscriptionCancelSchema>;
