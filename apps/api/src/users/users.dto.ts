import { z } from "zod";
import { USER_ROLES } from "@nomosos/shared";
import { PASSWORD_MAX_LENGTH } from "../auth/auth.constants";

/**
 * BÜRO KULLANICI YÖNETİMİ ŞEMALARI — denetim bulgusu K-03.
 *
 * Bu uçlar hiç yoktu: `grep "client\\.user\\.(create|update|delete|upsert)"`
 * depoda SIFIR sonuç veriyordu. API bir kiracı kullanıcısı açamıyor,
 * pasifleştiremiyor, rolünü değiştiremiyor, parolasını sıfırlayamıyordu.
 * `jwt-auth.guard.ts` "pasifleştirilen kullanıcı 12 saat yetkili kalmasın"
 * güvencesini veriyordu ama kullanıcıyı pasifleştirecek bir uç olmadığı için
 * o güvence hiç tetiklenemiyordu.
 */

const passwordField = z
  .string()
  .min(10, "Parola en az 10 karakter olmalıdır.")
  .max(PASSWORD_MAX_LENGTH, `Parola en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.`);

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().max(200).email("Geçerli bir e-posta girin."),
  fullName: z.string().trim().min(3, "Ad soyad en az 3 karakter olmalıdır.").max(200),
  role: z.enum(USER_ROLES, { errorMap: () => ({ message: "Geçersiz rol." }) }),
  barNumber: z.string().trim().max(50).optional(),
  password: passwordField,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(3).max(200).optional(),
    role: z.enum(USER_ROLES, { errorMap: () => ({ message: "Geçersiz rol." }) }).optional(),
    barNumber: z.string().trim().max(50).nullish(),
    isActive: z.boolean().optional(),
    /** Faz 7C: rol matrisi — role ek yetenekler. */
    permissions: z.array(z.enum(["HUKUKI", "ONAY", "OPERASYON", "FINANS"])).max(4).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * Yönetici tarafından parola sıfırlama.
 *
 * Mevcut parola SORULMAZ (yönetici zaten bilmiyor); bunun karşılığında işlem
 * hedefin TÜM OTURUMLARINI DÜŞÜRÜR ve denetim kaydına yazılır. Sızmış bir
 * parolayı kapatmanın ürün içindeki yolu budur.
 */
export const resetUserPasswordSchema = z.object({
  newPassword: passwordField,
});
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
