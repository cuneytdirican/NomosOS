import { z } from "zod";
import {
  AI_PROVIDER_TYPES,
  CASE_TYPES,
  CLIENT_TYPES,
  TASK_PRIORITIES,
  USER_ROLES,
} from "./constants";
import { AI_TASK_TYPES } from "./ai-task-types";

/** TC Kimlik No doğrulaması (algoritmik). */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = value.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = (odd * 7 - even + 10) % 10; // negatif kalmaması için +10
  const d11 = (d.slice(0, 10).reduce((a, b) => a + b, 0)) % 10;
  return d10 === d[9] && d11 === d[10];
}

/**
 * İ-63: TÜM Zod mesajları Türkçedir. Zod'un öntanımlı İngilizce metinleri
 * ("String must contain at least 2 character(s)") doğrulama hatası olarak
 * avukata ulaşıyordu. Aşağıdaki her alanda mesaj AÇIKÇA verilmiştir; yeni
 * alan eklerken mesajsız bırakmayın.
 */

/**
 * KİRACI (BÜRO) GİRİŞİ — denetim bulgusu Ö-07.
 *
 * E-posta NORMALİZE EDİLİR: `.trim().toLowerCase()`. Eskiden ham geçiyordu ve
 * `auth.service.ts` `findUnique({ where: { email } })` ile birebir eşleşme
 * arıyordu. Canlı ölçüm:
 *     partner@demo.nomosos.local  -> 200
 *     Partner@Demo.Nomosos.Local  -> 401 "E-posta veya şifre hatalı."
 * Diğer iki kimlik alanı (platform, portal) BU İŞİ ZATEN DOĞRU YAPIYORDU
 * (`.trim().toLowerCase().max(200)`); yalnız büro tarafı geride kalmıştı.
 * Parola değiştirme ucu da olmadığı için (K-03) bu, çözümsüz bir destek
 * döngüsüne dönüşüyordu.
 *
 * PAROLA ÜST SINIRI: bcrypt 72 baytın ötesini yok sayar; üst sınırsız alan,
 * her istekte pahalı bir karma hesabı tetikleyen ucuz bir DoS yüzeyidir.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200, "E-posta en fazla 200 karakter olabilir.")
    .email("Geçerli bir e-posta adresi girin."),
  password: z
    .string()
    .min(8, "Parola en az 8 karakter olmalıdır.")
    .max(200, "Parola en fazla 200 karakter olabilir."),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** POST /auth/change-password — kendi parolasını değiştirme (K-03). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mevcut parolanızı girin.").max(200),
    newPassword: z
      .string()
      .min(10, "Yeni parola en az 10 karakter olmalıdır.")
      .max(200, "Yeni parola en fazla 200 karakter olabilir."),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "Yeni parola mevcut parolayla aynı olamaz.",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createClientSchema = z.object({
  type: z.enum(CLIENT_TYPES, {
    errorMap: () => ({ message: "Geçersiz müvekkil türü." }),
  }),
  name: z
    .string()
    .min(2, "Müvekkil adı/unvanı en az 2 karakter olmalıdır.")
    .max(300, "Müvekkil adı/unvanı en fazla 300 karakter olabilir."),
  tckn: z.string().optional().refine((v) => !v || isValidTckn(v), "Geçersiz TC Kimlik No"),
  taxNumber: z
    .string()
    .regex(/^\d{10}$/, "Vergi Kimlik No 10 haneli olmalıdır.")
    .optional(),
  taxOffice: z.string().max(120, "Vergi dairesi en fazla 120 karakter olabilir.").optional(),
  email: z.string().email("Geçerli bir e-posta adresi girin.").optional(),
  phone: z.string().max(30, "Telefon en fazla 30 karakter olabilir.").optional(),
  address: z.string().max(1000, "Adres en fazla 1000 karakter olabilir.").optional(),
  notes: z.string().max(5000, "Notlar en fazla 5000 karakter olabilir.").optional(),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const createCaseSchema = z.object({
  clientId: z.string().uuid("Geçersiz müvekkil kimliği."),
  type: z.enum(CASE_TYPES, { errorMap: () => ({ message: "Geçersiz dosya türü." }) }),
  title: z
    .string()
    .min(3, "Dosya başlığı en az 3 karakter olmalıdır.")
    .max(300, "Dosya başlığı en fazla 300 karakter olabilir."),
  courtName: z.string().max(200, "Mahkeme adı en fazla 200 karakter olabilir.").optional(),
  fileNumber: z.string().max(50, "Esas no en fazla 50 karakter olabilir.").optional(), // örn. 2026/145
  judgeName: z.string().max(150, "Hakim adı en fazla 150 karakter olabilir.").optional(),
  subject: z.string().max(2000, "Dava konusu en fazla 2000 karakter olabilir.").optional(),
  responsibleUserId: z.string().uuid("Geçersiz sorumlu avukat kimliği.").optional(),
});
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export const createTaskSchema = z.object({
  caseId: z.string().uuid("Geçersiz dosya kimliği.").optional(),
  title: z
    .string()
    .min(3, "Görev başlığı en az 3 karakter olmalıdır.")
    .max(300, "Görev başlığı en fazla 300 karakter olabilir."),
  description: z.string().max(5000, "Görev açıklaması en fazla 5000 karakter olabilir.").optional(),
  assigneeId: z.string().uuid("Geçersiz atanan kullanıcı kimliği."),
  reviewerId: z.string().uuid("Geçersiz kontrolcü kullanıcı kimliği.").optional(),
  dueDate: z.coerce.date({ invalid_type_error: "Son tarih geçerli bir tarih olmalıdır." }).optional(),
  priority: z
    .enum(TASK_PRIORITIES, { errorMap: () => ({ message: "Geçersiz öncelik." }) })
    .default("NORMAL"),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const createUserSchema = z.object({
  email: z.string().email("Geçerli bir e-posta adresi girin."),
  password: z.string().min(8, "Parola en az 8 karakter olmalıdır."),
  fullName: z
    .string()
    .min(2, "Ad soyad en az 2 karakter olmalıdır.")
    .max(200, "Ad soyad en fazla 200 karakter olabilir."),
  role: z.enum(USER_ROLES, { errorMap: () => ({ message: "Geçersiz kullanıcı rolü." }) }),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** AI sağlayıcı yapılandırması (Ayarlar → AI Sağlayıcı). */
export const aiProviderConfigSchema = z.object({
  name: z
    .string()
    .min(2, "Sağlayıcı adı en az 2 karakter olmalıdır.")
    .max(100, "Sağlayıcı adı en fazla 100 karakter olabilir."),
  type: z.enum(AI_PROVIDER_TYPES, {
    errorMap: () => ({ message: "Geçersiz sağlayıcı türü." }),
  }),
  apiKey: z.string().max(500, "API anahtarı en fazla 500 karakter olabilir.").optional(),
  baseUrl: z.string().url("Geçerli bir URL girin.").optional(),
  defaultModel: z
    .string()
    .min(1, "Varsayılan model adı zorunludur.")
    .max(200, "Model adı en fazla 200 karakter olabilir."),
  /** CUSTOM tipi için: isteğe eklenecek ek header'lar. */
  headers: z.record(z.string()).optional(),
  /** CUSTOM tipi için: istek/yanıt alan eşlemesi. */
  mapping: z
    .object({
      /** İstek gövdesinde mesajların yazılacağı alan yolu (örn. "messages" veya "input.prompt"). */
      requestMessagesField: z.string().default("messages"),
      /** İstek gövdesinde model adının yazılacağı alan yolu. */
      requestModelField: z.string().default("model"),
      /** Yanıtta üretilen metnin okunacağı alan yolu (örn. "choices.0.message.content"). */
      responseTextField: z.string().default("choices.0.message.content"),
    })
    .optional(),
});
export type AiProviderConfigInput = z.infer<typeof aiProviderConfigSchema>;

/** Görev tipi → sağlayıcı/model eşlemesi. */
export const aiTaskRouteSchema = z.object({
  taskType: z.enum(AI_TASK_TYPES, { errorMap: () => ({ message: "Geçersiz görev tipi." }) }),
  providerConfigId: z.string().uuid("Geçersiz sağlayıcı kimliği."),
  model: z
    .string()
    .min(1, "Model adı zorunludur.")
    .max(200, "Model adı en fazla 200 karakter olabilir."),
});
export type AiTaskRouteInput = z.infer<typeof aiTaskRouteSchema>;

export const caseChatSchema = z.object({
  caseId: z.string().uuid("Geçersiz dosya kimliği.").optional(),
  message: z
    .string()
    .min(1, "Mesaj boş olamaz.")
    .max(20000, "Mesaj en fazla 20000 karakter olabilir."),
  /** KVKK maskeleme onayı: dış sağlayıcıya giden metinde PII bulunduysa true gönderilmeli. */
  piiApproved: z.boolean().default(false),
});
export type CaseChatInput = z.infer<typeof caseChatSchema>;
