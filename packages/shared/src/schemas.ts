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
  email: z.string().trim().toLowerCase().max(200).email(),
  password: z.string().min(8).max(200),
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
  type: z.enum(CLIENT_TYPES),
  name: z.string().min(2).max(300),
  tckn: z.string().optional().refine((v) => !v || isValidTckn(v), "Geçersiz TC Kimlik No"),
  taxNumber: z.string().regex(/^\d{10}$/).optional(),
  taxOffice: z.string().max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(1000).optional(),
  notes: z.string().max(5000).optional(),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const createCaseSchema = z.object({
  clientId: z.string().uuid(),
  type: z.enum(CASE_TYPES),
  title: z.string().min(3).max(300),
  courtName: z.string().max(200).optional(),
  fileNumber: z.string().max(50).optional(), // örn. 2026/145
  judgeName: z.string().max(150).optional(),
  subject: z.string().max(2000).optional(),
  responsibleUserId: z.string().uuid().optional(),
});
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export const createTaskSchema = z.object({
  caseId: z.string().uuid().optional(),
  title: z.string().min(3).max(300),
  description: z.string().max(5000).optional(),
  assigneeId: z.string().uuid(),
  reviewerId: z.string().uuid().optional(),
  dueDate: z.coerce.date().optional(),
  priority: z.enum(TASK_PRIORITIES).default("NORMAL"),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2).max(200),
  role: z.enum(USER_ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** AI sağlayıcı yapılandırması (Ayarlar → AI Sağlayıcı). */
export const aiProviderConfigSchema = z.object({
  name: z.string().min(2).max(100),
  type: z.enum(AI_PROVIDER_TYPES),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().min(1).max(200),
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
  taskType: z.enum(AI_TASK_TYPES),
  providerConfigId: z.string().uuid(),
  model: z.string().min(1).max(200),
});
export type AiTaskRouteInput = z.infer<typeof aiTaskRouteSchema>;

export const caseChatSchema = z.object({
  caseId: z.string().uuid().optional(),
  message: z.string().min(1).max(20000),
  /** KVKK maskeleme onayı: dış sağlayıcıya giden metinde PII bulunduysa true gönderilmeli. */
  piiApproved: z.boolean().default(false),
});
export type CaseChatInput = z.infer<typeof caseChatSchema>;
