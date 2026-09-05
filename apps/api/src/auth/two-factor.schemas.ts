import { z } from "zod";

/** 6 haneli TOTP kodu — boşluklar temizlenir. */
const totpCode = z
  .string()
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Doğrulama kodu 6 haneli olmalıdır."));

/** POST /auth/2fa/verify — giriş ikinci adımı ya da kurulumun doğrulanması. */
export const twoFactorVerifySchema = z.object({
  challengeToken: z.string().min(20, "Doğrulama oturumu eksik.").max(4000),
  code: totpCode,
});
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;

/** POST /auth/2fa/setup — açık oturumla kurulum: mevcut parola ZORUNLU. */
export const twoFactorSetupSchema = z.object({
  currentPassword: z.string().min(1, "Mevcut parolanızı girin.").max(200),
});
export type TwoFactorSetupInput = z.infer<typeof twoFactorSetupSchema>;

/** POST /auth/2fa/setup-with-challenge — girişte zorunlu kurulum (büro politikası). */
export const twoFactorSetupWithChallengeSchema = z.object({
  challengeToken: z.string().min(20, "Doğrulama oturumu eksik.").max(4000),
});
export type TwoFactorSetupWithChallengeInput = z.infer<typeof twoFactorSetupWithChallengeSchema>;

/** POST /auth/2fa/disable — kapatma: parola + güncel kod. */
export const twoFactorDisableSchema = z.object({
  currentPassword: z.string().min(1, "Mevcut parolanızı girin.").max(200),
  code: totpCode,
});
export type TwoFactorDisableInput = z.infer<typeof twoFactorDisableSchema>;
