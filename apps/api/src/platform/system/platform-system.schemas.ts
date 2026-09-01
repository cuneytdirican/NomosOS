import { z } from "zod";
import { reasonField } from "../tenants/platform-tenants.schemas";

/**
 * SİSTEM AYARI.
 *
 * `value` serbest JSON'dur (tipli key-value). SIR SAKLANMAZ: API anahtarları,
 * parolalar ve imza anahtarları `.env`'de kalır (spec §Veri Modeli
 * "secret'lar buraya KONMAZ").
 */
export const settingPutSchema = z.object({
  value: z.unknown(),
  description: z.string().trim().max(500).nullable().optional(),
  /** Bakım tam kilidi gibi dört-göz gerektiren ayarlarda zorunludur. */
  reason: z.string().trim().max(1000).optional(),
});
export type SettingPutInput = z.infer<typeof settingPutSchema>;

/** Bakım modu değeri — tam kilit (`fullLock`) dört-göz onayına tabidir. */
export const maintenanceValueSchema = z.object({
  enabled: z.boolean(),
  fullLock: z.boolean().default(false),
  message: z.string().trim().max(500).optional(),
});

export const flagCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-_]{1,63}$/, "Bayrak anahtarı 2-64 karakter, küçük harf/rakam/-/_ olmalıdır."),
  description: z.string().trim().max(500).nullable().optional(),
  enabledTenantIds: z.array(z.string().uuid()).max(1000).default([]),
  /**
   * F2-Ö-34: Platform GENELİ açma — artık OLUŞTURMA sırasında da kabul edilir.
   * Dört-göz onayı Zod'da değil, SERVİSTE uygulanır (flag global write ayrıcalığı).
   */
  isEnabledGlobally: z.boolean().optional(),
});
export type FlagCreateInput = z.infer<typeof flagCreateSchema>;

export const flagPatchSchema = z
  .object({
    description: z.string().trim().max(500).nullable().optional(),
    /** Platform GENELİ açma/kapama — dört-göz. */
    isEnabledGlobally: z.boolean().optional(),
    /** Tenant allowlist — olağan yazma. */
    enabledTenantIds: z.array(z.string().uuid()).max(1000).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine(
    (v) =>
      v.description !== undefined ||
      v.isEnabledGlobally !== undefined ||
      v.enabledTenantIds !== undefined,
    { message: "Değiştirilecek en az bir alan gönderilmelidir." }
  );
export type FlagPatchInput = z.infer<typeof flagPatchSchema>;

export const announcementCreateSchema = z.object({
  title: z.string().trim().min(3, "Başlık en az 3 karakter olmalıdır.").max(200),
  body: z.string().trim().min(3, "Duyuru metni zorunludur.").max(10000),
  severity: z.enum(["BILGI", "UYARI", "KRITIK"]).default("BILGI"),
  audience: z.enum(["TUM", "PLAN_BAZLI", "TENANT_BAZLI"]).default("TUM"),
  /** PLAN_BAZLI → planKeys[], TENANT_BAZLI → tenantIds[] */
  target: z
    .object({
      planKeys: z.array(z.string().trim().max(32)).max(50).optional(),
      tenantIds: z.array(z.string().uuid()).max(1000).optional(),
    })
    .nullable()
    .optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});
export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;

export const announcementPatchSchema = announcementCreateSchema.partial();
export type AnnouncementPatchInput = z.infer<typeof announcementPatchSchema>;

/** Bakım tam kilidi talebinde gerekçe zorunlu hâle gelir. */
export const maintenanceLockSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(500).optional(),
  reason: reasonField,
});
export type MaintenanceLockInput = z.infer<typeof maintenanceLockSchema>;
