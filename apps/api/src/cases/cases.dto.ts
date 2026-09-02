import { z } from "zod";
import { CASE_STATUSES, CASE_TYPES, PARTY_ROLES } from "@nomosos/shared";
import { nullableDate, nullableText, nullableUuid } from "../common/zod";

/** Prisma DecisionType ile birebir. */
export const DECISION_TYPES = [
  "ARA_KARAR",
  "GEREKCELI_KARAR",
  "ISTINAF_KARARI",
  "TEMYIZ_KARARI",
  "KESIN_KARAR",
] as const;
export type DecisionTypeValue = (typeof DECISION_TYPES)[number];

/** PATCH /cases/:id */
export const updateCaseSchema = z
  .object({
    type: z.enum(CASE_TYPES, { errorMap: () => ({ message: "Geçersiz dosya türü." }) }).optional(),
    title: z.string().min(3, "Dosya başlığı en az 3 karakter olmalıdır.").max(300, "Dosya başlığı en fazla 300 karakter olabilir.").optional(),
    courtName: nullableText(200, "Mahkeme adı"),
    fileNumber: nullableText(50, "Esas no"),
    judgeName: nullableText(150, "Hakim adı"),
    subject: nullableText(2000, "Dava konusu"),
    // F2-Ö-07: dava değeri kuruş hassasiyeti ister — `coerce.number()` her
    // float'u (0.30000000000000004 gibi) kabul ediyordu. En fazla İKİ ondalık
    // kabul edilir; daha hassas girdi reddedilir (kuruş altı anlamsızdır).
    amount: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.coerce
        .number({ invalid_type_error: "Dava değeri sayı olmalıdır." })
        .min(0, "Dava değeri negatif olamaz.")
        .refine(
          (n) => Math.round(n * 100) === n * 100,
          "Dava değeri en fazla iki ondalık basamak içerebilir (kuruş hassasiyeti).",
        )
        .nullable()
        .optional()
    ),
    responsibleUserId: nullableUuid("Sorumlu avukat"),
    // İ-10: status PATCH'te de değiştirilebilir; closedAt yalnız status ile.
    status: z.enum(CASE_STATUSES).optional(),
    closedAt: nullableDate("Kapanış tarihi"),
  })
  .refine(
    (data) => {
      if (data.closedAt !== undefined && data.status !== undefined && data.status !== "KAPANDI") {
        return false;
      }
      return true;
    },
    "Kapanış tarihi yalnızca dosya durumu KAPANDI olarak değiştirilirken yazılabilir.",
  )
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;

/** PATCH /cases/:id/status */
export const changeCaseStatusSchema = z.object({
  status: z.enum(CASE_STATUSES, { errorMap: () => ({ message: "Geçersiz dosya durumu." }) }),
  note: z.string().max(2000, "Gerekçe en fazla 2000 karakter olabilir.").optional(),
  /** Kapanışta açık süre/görev engelini aşmak için (yalnız ORTAK/YÖNETİCİ). */
  force: z.boolean().optional().default(false),
});
export type ChangeCaseStatusInput = z.infer<typeof changeCaseStatusSchema>;

/** POST /cases/:id/notes */
export const createCaseNoteSchema = z.object({
  content: z.string().min(1, "Not içeriği boş olamaz.").max(10000, "Not en fazla 10000 karakter olabilir."),
  isPinned: z.boolean().optional().default(false),
});
export type CreateCaseNoteInput = z.infer<typeof createCaseNoteSchema>;

/** PATCH /notes/:id */
export const updateCaseNoteSchema = z
  .object({
    content: z.string().min(1, "Not içeriği boş olamaz.").max(10000, "Not en fazla 10000 karakter olabilir.").optional(),
    isPinned: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateCaseNoteInput = z.infer<typeof updateCaseNoteSchema>;

/** POST /cases/:id/decisions */
export const createCaseDecisionSchema = z.object({
  type: z.enum(DECISION_TYPES, { errorMap: () => ({ message: "Geçersiz karar türü." }) }),
  date: z.coerce.date({ invalid_type_error: "Karar tarihi geçerli bir tarih olmalıdır." }),
  summary: z.string().min(3, "Karar özeti en az 3 karakter olmalıdır.").max(5000, "Karar özeti en fazla 5000 karakter olabilir."),
  outcome: nullableText(200, "Sonuç"),
  documentId: nullableUuid("Belge"),
});
export type CreateCaseDecisionInput = z.infer<typeof createCaseDecisionSchema>;

/** POST /cases/:id/timeline — manuel safahat kaydı */
export const createTimelineEventSchema = z.object({
  title: z.string().min(3, "Safahat başlığı en az 3 karakter olmalıdır.").max(300, "Safahat başlığı en fazla 300 karakter olabilir."),
  detail: nullableText(5000, "Açıklama"),
  date: z.coerce.date({ invalid_type_error: "Tarih geçerli olmalıdır." }).optional(),
});
export type CreateTimelineEventInput = z.infer<typeof createTimelineEventSchema>;

/** POST /cases/:id/parties */
export const createCasePartySchema = z.object({
  role: z.enum(PARTY_ROLES, { errorMap: () => ({ message: "Geçersiz taraf sıfatı." }) }),
  name: z.string().min(2, "Taraf adı en az 2 karakter olmalıdır.").max(300, "Taraf adı en fazla 300 karakter olabilir."),
  isClient: z.boolean().optional().default(false),
  lawyerName: nullableText(200, "Vekil adı"),
  notes: nullableText(2000, "Notlar"),
});
export type CreateCasePartyInput = z.infer<typeof createCasePartySchema>;
