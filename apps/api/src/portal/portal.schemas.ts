import { z } from "zod";
import { PORTAL_MIN_PASSWORD_LENGTH } from "./portal.constants";

/**
 * Portal giriş/yazma uçlarının doğrulama şemaları.
 *
 * Hepsi `.strict()` DEĞİL ama her alan açıkça yazılır ve Zod bilinmeyen
 * anahtarları düşürür; gövdeden gelen fazladan alan hiçbir zaman Prisma'ya
 * geçmez (kütle atama / mass assignment yüzeyi kapalıdır).
 */

/** Portal parolası — müvekkil yüzü olduğu için büro tarafından daha uzundur. */
const portalPassword = z
  .string()
  .min(
    PORTAL_MIN_PASSWORD_LENGTH,
    `Parola en az ${PORTAL_MIN_PASSWORD_LENGTH} karakter olmalıdır.`
  )
  .max(200, "Parola en fazla 200 karakter olabilir.")
  .refine((value) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(value) && /[0-9]/.test(value), {
    message: "Parola en az bir harf ve en az bir rakam içermelidir.",
  });

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Geçerli bir e-posta adresi girin.")
  .max(200);

/** Ham davet/sıfırlama token'ı — 64 hane hex (32 bayt). */
const rawToken = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/i, "Bağlantı geçersiz. Lütfen size iletilen bağlantıyı kullanın.");

export const portalLoginSchema = z.object({
  email,
  password: z.string().min(1, "Parola girin.").max(200),
  /**
   * Aynı e-posta birden çok büroda portal hesabı olabilir (`@@unique([tenantId,email])`).
   * Portal alan adı büroyu belirliyorsa istemci bunu gönderir; göndermezse
   * sunucu adayları parola ile ayırır (bkz. PortalAuthService.login).
   */
  tenantId: z.string().uuid().optional(),
});
export type PortalLoginInput = z.infer<typeof portalLoginSchema>;

export const portalAcceptInviteSchema = z.object({
  token: rawToken,
  /** Müvekkil kendi görünen adını yazar — davet kaydında ad alanı yoktur. */
  fullName: z.string().trim().min(2, "Ad soyad girin.").max(150),
  password: portalPassword,
});
export type PortalAcceptInviteInput = z.infer<typeof portalAcceptInviteSchema>;

/**
 * Davet ön kontrolü — `POST /portal/auth/invite/check`.
 *
 * TOKEN GÖVDEDE TAŞINIR, YOLDA DEĞİL (denetim bulgusu 8). Yol parametresi
 * olsaydı ham token; tarayıcı geçmişine, önündeki her ters vekilin/CDN'in
 * erişim günlüğüne ve sayfadan çıkan her isteğin `Referer` başlığına düşerdi.
 * Token'ın veritabanında hash'lenerek saklanması bu yolu KAPATMAZ: sızan şey
 * ham token'ın kendisidir.
 */
export const portalInviteCheckSchema = z.object({ token: rawToken });
export type PortalInviteCheckInput = z.infer<typeof portalInviteCheckSchema>;

export const portalForgotPasswordSchema = z.object({
  email,
  tenantId: z.string().uuid().optional(),
});
export type PortalForgotPasswordInput = z.infer<typeof portalForgotPasswordSchema>;

export const portalResetPasswordSchema = z.object({
  token: rawToken,
  password: portalPassword,
});
export type PortalResetPasswordInput = z.infer<typeof portalResetPasswordSchema>;

/** Müvekkilin portaldan yazdığı mesaj — büroda `InboundMessage` olarak açılır. */
export const portalMessageSchema = z.object({
  subject: z.string().trim().max(200).optional(),
  body: z
    .string()
    .trim()
    .min(2, "Mesaj metni girin.")
    .max(5_000, "Mesaj en fazla 5.000 karakter olabilir."),
  /**
   * İsteğe bağlı dosya bağlantısı. Dosya YAYINLANMAMIŞSA reddedilir: aksi hâlde
   * müvekkil, göremediği bir dosyanın id'sini mesajına iliştirerek o dosyanın
   * varlığını doğrulayabilirdi.
   */
  caseId: z.string().uuid().optional(),
});
export type PortalMessageInput = z.infer<typeof portalMessageSchema>;

/* ------------------------------------------------------------------ *
 * Büro tarafı (portal-admin) şemaları
 * ------------------------------------------------------------------ */

const portalResourceType = z.enum([
  "DOSYA",
  "BELGE",
  "DURUSMA",
  "SAFAHAT_KAYDI",
  "FATURA",
  "MESAJ",
  "ODEME",
]);

export const portalInviteSchema = z.object({
  clientId: z.string().uuid(),
  email,
});
export type PortalInviteInput = z.infer<typeof portalInviteSchema>;

export const portalPublishSchema = z.object({
  clientId: z.string().uuid(),
  resourceType: portalResourceType,
  resourceId: z.string().uuid(),
  /**
   * Müvekkile gösterilecek sade açıklama. SAFAHAT_KAYDI yayınında AI durum
   * özetinin ONAYLANMIŞ metni buraya yazılır ve DONDURULUR: kaynak safahat
   * kaydı sonradan değişse bile müvekkilin gördüğü metin sabit kalır
   * (spec §İş Kuralları 4).
   */
  note: z.string().trim().max(2_000).optional(),
});
export type PortalPublishInput = z.infer<typeof portalPublishSchema>;

/**
 * TOPLU YAYIN — her kaynak AÇIKÇA seçilir.
 *
 * "Tüm dosyayı yayınla" gibi bir kısayol BİLEREK YOKTUR (görev tanımı §4):
 * böyle bir düğme, avukatın görmediği belgeleri de tek tıkla müvekkile açardı.
 * Buradaki toplu uç yalnızca listeden TEK TEK seçilmiş id'leri kabul eder ve
 * 100 kayıtla sınırlıdır.
 */
export const portalBulkPublishSchema = z.object({
  clientId: z.string().uuid(),
  resourceType: portalResourceType,
  resourceIds: z
    .array(z.string().uuid())
    .min(1, "En az bir kayıt seçin.")
    .max(100, "Tek seferde en fazla 100 kayıt yayınlanabilir."),
  note: z.string().trim().max(2_000).optional(),
});
export type PortalBulkPublishInput = z.infer<typeof portalBulkPublishSchema>;
