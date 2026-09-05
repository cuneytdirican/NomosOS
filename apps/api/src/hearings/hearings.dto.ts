import { z } from "zod";
import { HEARING_TYPES } from "@nomosos/shared";
import { nullableText } from "../common/zod";

/** Prisma HearingStatus ile birebir. */
export const HEARING_STATUSES = ["PLANLANDI", "YAPILDI", "ERTELENDI", "IPTAL"] as const;
export type HearingStatusValue = (typeof HEARING_STATUSES)[number];

/** POST /hearings */
export const createHearingSchema = z.object({
  caseId: z.string().uuid("Dosya seçilmelidir."),
  type: z.enum(HEARING_TYPES, { errorMap: () => ({ message: "Geçersiz duruşma türü." }) }).optional().default("DURUSMA"),
  status: z.enum(HEARING_STATUSES, { errorMap: () => ({ message: "Geçersiz duruşma durumu." }) }).optional().default("PLANLANDI"),
  date: z.coerce.date({ invalid_type_error: "Duruşma tarihi geçerli olmalıdır." }),
  courtroom: nullableText(100, "Duruşma salonu"),
  note: nullableText(5000, "Duruşma notu"),
  prepSummary: nullableText(5000, "Hazırlık notu"),
  /** Faz 1: duruşmaya girecek sorumlu avukat (büro kullanıcısı). */
  attendeeUserId: z.string().uuid("Geçersiz avukat kimliği.").nullable().optional(),
  /** Aynı avukatın ±2 saatte başka duruşması varsa 409; bilerek eklemek için true. */
  force: z.boolean().optional(),
});
export type CreateHearingInput = z.infer<typeof createHearingSchema>;

/** POST /hearings/:id/prep — HEARING_PREP hazırlık paketi. */
export const hearingPrepSchema = z.object({
  piiApproved: z.boolean().optional(),
});
export type HearingPrepInput = z.infer<typeof hearingPrepSchema>;

/** PATCH /hearings/:id */
export const updateHearingSchema = z
  .object({
    type: z.enum(HEARING_TYPES, { errorMap: () => ({ message: "Geçersiz duruşma türü." }) }).optional(),
    status: z.enum(HEARING_STATUSES, { errorMap: () => ({ message: "Geçersiz duruşma durumu." }) }).optional(),
    date: z.coerce.date({ invalid_type_error: "Duruşma tarihi geçerli olmalıdır." }).optional(),
    courtroom: nullableText(100, "Duruşma salonu"),
    note: nullableText(5000, "Duruşma notu"),
    prepSummary: nullableText(5000, "Hazırlık notu"),
    attendeeUserId: z.string().uuid("Geçersiz avukat kimliği.").nullable().optional(),
    force: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateHearingInput = z.infer<typeof updateHearingSchema>;

/** PATCH /hearings/:id/result — duruşma sonucu + safahat kaydı */
export const hearingResultSchema = z.object({
  status: z.enum(["YAPILDI", "ERTELENDI", "IPTAL"], {
    errorMap: () => ({ message: "Duruşma sonucu YAPILDI, ERTELENDI veya IPTAL olmalıdır." }),
  }),
  note: z.string().min(3, "Duruşma sonucu/ara karar özeti en az 3 karakter olmalıdır.").max(5000, "Duruşma notu en fazla 5000 karakter olabilir."),
  /** Ertelenen duruşma için yeni tarih — verilirse yeni Hearing kaydı açılır. */
  nextDate: z.coerce.date({ invalid_type_error: "Sonraki duruşma tarihi geçerli olmalıdır." }).optional(),
  nextType: z.enum(HEARING_TYPES, { errorMap: () => ({ message: "Geçersiz duruşma türü." }) }).optional(),
  nextCourtroom: nullableText(100, "Duruşma salonu"),
});
export type HearingResultInput = z.infer<typeof hearingResultSchema>;
