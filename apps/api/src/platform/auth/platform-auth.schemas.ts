import { z } from "zod";

/**
 * Platform kimlik uçlarının Zod şemaları.
 * Yeni şemalar modül klasöründe YEREL tanımlanır (ortak karar 8).
 */

export const platformLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Geçerli bir e-posta adresi giriniz.")
    .max(200, "E-posta en fazla 200 karakter olabilir."),
  password: z
    .string()
    .min(1, "Şifre zorunludur.")
    .max(200, "Şifre en fazla 200 karakter olabilir."),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const twoFactorSetupSchema = z.object({
  /** Girişin ilk adımından dönen ara token (oturum yoksa zorunlu). */
  challengeToken: z.string().min(10).max(4000).optional(),
  /**
   * MEVCUT PAROLA — `challengeToken` yerine panel oturumuyla (Bearer) kurulum
   * yapılıyorsa ZORUNLUDUR (denetim bulgusu Ö-01).
   *
   * Eskiden `bearerToken` dalı yalnız imza ve audience doğruluyordu; çalınmış
   * bir panel token'ıyla `POST /auth/2fa/setup -d '{}'` çağrısı parola sorulmadan
   * gizli anahtar döndürüyordu (canlı doğrulandı). Saldırgan kendi
   * doğrulayıcısını kalıcılaştırdıktan sonra, meşru sahip parolasını bilse bile
   * `changePassword` TOTP istediği için hesaba giremiyordu: ele geçirme süresi
   * 8 saatten SÜRESİZE çıkıyordu.
   *
   * Tek koruma "hesapta zaten 2FA varsa reddet" idi ve tam da 2FA'sı olmayan
   * hesaplarda — yani üretimdeki ilk açılışta hepsinde — devre dışıydı.
   */
  currentPassword: z.string().min(1).max(200).optional(),
});
export type TwoFactorSetupInput = z.infer<typeof twoFactorSetupSchema>;

export const twoFactorVerifySchema = z.object({
  challengeToken: z.string().min(10, "Doğrulama oturumu bulunamadı.").max(4000),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Doğrulama kodu 6 haneli olmalıdır."),
});
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;

/**
 * KENDİ PAROLASINI DEĞİŞTİRME.
 *
 * Panel kullanıcı yönetimi ucundan kendi parolasını değiştirmek KAPALIDIR
 * (denetim bulgusu 1): orası başkasının kimlik bilgisine dokunan bir yönetim
 * işlemidir ve dört-göze tabidir. Kendi parolası için mevcut parola — 2FA
 * kuruluysa ayrıca geçerli bir TOTP kodu — zorunludur.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Mevcut parola zorunludur.").max(200),
  newPassword: z
    .string()
    .min(14, "Panel parolası en az 14 karakter olmalıdır (yönetici hesabı).")
    .max(200, "Parola en fazla 200 karakter olabilir."),
  /** 2FA kuruluysa zorunlu (servis katmanı denetler). */
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Doğrulama kodu 6 haneli olmalıdır.")
    .optional(),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
