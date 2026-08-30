import { z } from "zod";

/**
 * Panel personeli parolası — spec §Güvenlik 3: asgari 14 karakter, argon2id.
 *
 * NOT: bu kod tabanında parola özeti için `bcryptjs` kullanılır (tenant
 * tarafıyla aynı kütüphane; yeni bağımlılık bu fazda eklenemiyor). argon2id'ye
 * geçiş, iki tarafta birlikte yapılacak bir göç işidir ve teslim raporunda
 * açıkça not düşülmüştür.
 */
const passwordField = z
  .string()
  .min(14, "Panel parolası en az 14 karakter olmalıdır (yönetici hesabı).")
  .max(200, "Parola en fazla 200 karakter olabilir.");

export const platformUserCreateSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Geçerli bir e-posta adresi giriniz.")
    .max(200),
  fullName: z.string().trim().min(2, "Ad soyad zorunludur.").max(150),
  password: passwordField,
  role: z.enum(["SUPER_ADMIN", "OPS_ADMIN", "BILLING_ADMIN", "SUPPORT_AGENT", "ANALYST_READONLY"], {
    errorMap: () => ({ message: "Geçersiz panel rolü." }),
  }),
  /** SUPER_ADMIN ataması dört-göz onayına tabidir; gerekçe zorunlu olur. */
  reason: z.string().trim().max(1000).optional(),
});
export type PlatformUserCreateInput = z.infer<typeof platformUserCreateSchema>;

export const platformUserPatchSchema = z
  .object({
    fullName: z.string().trim().min(2).max(150).optional(),
    role: z
      .enum(["SUPER_ADMIN", "OPS_ADMIN", "BILLING_ADMIN", "SUPPORT_AGENT", "ANALYST_READONLY"])
      .optional(),
    isActive: z.boolean().optional(),
    /** Yeni parola (isteğe bağlı). */
    password: passwordField.optional(),
    /** 2FA kaydını sıfırlar — kullanıcı bir sonraki girişte yeniden kurar. */
    resetTwoFactor: z.boolean().optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine(
    (v) =>
      v.fullName !== undefined ||
      v.role !== undefined ||
      v.isActive !== undefined ||
      v.password !== undefined ||
      v.resetTwoFactor !== undefined,
    { message: "Değiştirilecek en az bir alan gönderilmelidir." }
  );
export type PlatformUserPatchInput = z.infer<typeof platformUserPatchSchema>;
