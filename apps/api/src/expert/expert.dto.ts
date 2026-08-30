/**
 * Bilirkişi modülü Zod şemaları — modül yereli (ortak karar 4).
 */

import { z } from "zod";
import { nullableDate, nullableText, nullableUuid } from "../common/zod";

export const EXPERT_REPORT_TYPES = ["ASIL", "EK", "UZMAN_MUTALAASI"] as const;
export const OBJECTION_STATUSES = ["TASLAK", "SUNULDU", "KABUL", "RED"] as const;

/* ---------------------- Bilirkişi kişi kaydı ---------------------- */

export const createExpertSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, "Bilirkişi adı en az 3 karakter olmalıdır.")
    .max(200, "Bilirkişi adı en fazla 200 karakter olabilir."),
  specialty: nullableText(200, "Uzmanlık alanı"),
  institution: nullableText(200, "Kurum"),
  /** Büro içi değerlendirme notu — bu bilirkişiyle geçmiş tecrübe. */
  note: nullableText(4000, "Not"),
});
export type CreateExpertInput = z.infer<typeof createExpertSchema>;

export const updateExpertSchema = z
  .object({
    fullName: z.string().trim().min(3).max(200).optional(),
    specialty: nullableText(200, "Uzmanlık alanı"),
    institution: nullableText(200, "Kurum"),
    note: nullableText(4000, "Not"),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Güncellenecek en az bir alan gerekir." });
export type UpdateExpertInput = z.infer<typeof updateExpertSchema>;

/* -------------------------- Rapor kaydı --------------------------- */

export const createExpertReportSchema = z.object({
  expertId: nullableUuid("Bilirkişi kimliği"),
  reportType: z.enum(EXPERT_REPORT_TYPES).optional(),
  /** Rapor belgesi (Document.id) — OCR metni diff ajanının girdisidir. */
  documentId: nullableUuid("Belge kimliği"),
  /** Raporun dosyaya girdiği/alındığı tarih. */
  receivedAt: z.coerce.date({
    invalid_type_error: "Rapor tarihi geçerli bir tarih olmalıdır.",
    required_error: "Rapor tarihi zorunludur.",
  }),
  /**
   * TEBLİĞ TARİHİ — itiraz süresinin TETİKLEYİCİSİDİR. Girildiğinde
   * HMK m.281 süresi DETERMİNİSTİK motorda hesaplanır ve avukat onayına
   * (BEKLIYOR) sunulur.
   */
  servedAt: nullableDate("Tebliğ tarihi"),
  summary: nullableText(8000, "Özet"),
  conclusionText: nullableText(8000, "Sonuç bölümü"),
});
export type CreateExpertReportInput = z.infer<typeof createExpertReportSchema>;

export const updateExpertReportSchema = z
  .object({
    expertId: nullableUuid("Bilirkişi kimliği"),
    reportType: z.enum(EXPERT_REPORT_TYPES).optional(),
    documentId: nullableUuid("Belge kimliği"),
    receivedAt: z.coerce.date().optional(),
    servedAt: nullableDate("Tebliğ tarihi"),
    summary: nullableText(8000, "Özet"),
    conclusionText: nullableText(8000, "Sonuç bölümü"),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Güncellenecek en az bir alan gerekir." });
export type UpdateExpertReportInput = z.infer<typeof updateExpertReportSchema>;

/* --------------------------- İtiraz ------------------------------- */

export const objectionPointSchema = z.object({
  no: z.number().int().positive().optional(),
  topic: z
    .string()
    .trim()
    .min(3, "İtiraz maddesi konusu en az 3 karakter olmalıdır.")
    .max(300, "İtiraz maddesi konusu en fazla 300 karakter olabilir."),
  summary: z
    .string()
    .trim()
    .min(10, "İtiraz maddesi açıklaması en az 10 karakter olmalıdır.")
    .max(4000, "İtiraz maddesi açıklaması en fazla 4000 karakter olabilir."),
  /** Rapordan birebir alıntı veya dosya delil referansı. */
  sourceRef: nullableText(2000, "Kaynak"),
});
export type ObjectionPointInput = z.infer<typeof objectionPointSchema>;

export const createObjectionSchema = z.object({
  points: z
    .array(objectionPointSchema)
    .min(1, "En az bir itiraz maddesi gereklidir.")
    .max(60, "Bir itirazda en fazla 60 madde olabilir."),
  status: z.enum(OBJECTION_STATUSES).optional(),
});
export type CreateObjectionInput = z.infer<typeof createObjectionSchema>;

export const updateObjectionSchema = z
  .object({
    points: z.array(objectionPointSchema).min(1).max(60).optional(),
    status: z.enum(OBJECTION_STATUSES).optional(),
    petitionId: nullableUuid("Dilekçe kimliği"),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Güncellenecek en az bir alan gerekir." });
export type UpdateObjectionInput = z.infer<typeof updateObjectionSchema>;

export const draftPetitionSchema = z.object({
  title: nullableText(300, "Dilekçe başlığı"),
});
export type DraftPetitionInput = z.infer<typeof draftPetitionSchema>;

/* ----------------------- Rapor karşılaştırma ---------------------- */

export const compareReportsSchema = z.object({
  baseReportId: z.string().uuid("Temel rapor kimliği geçersiz."),
  compareReportId: z.string().uuid("Karşılaştırılacak rapor kimliği geçersiz."),
  /** KVKK 409 akışının ikinci turu. */
  piiApproved: z.boolean().optional(),
});
export type CompareReportsInput = z.infer<typeof compareReportsSchema>;
