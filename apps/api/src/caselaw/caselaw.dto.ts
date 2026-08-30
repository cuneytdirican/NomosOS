/**
 * İçtihat modülü giriş şemaları.
 *
 * packages/shared'e yazma yetkisi olmadığı için (ortak teknik karar 7) modüle
 * özgü şemalar burada yerel olarak tanımlanır.
 */

import { z } from "zod";

/** "2024/1183" biçimi — normalize edilip havuzda birebir aranır. */
const docketNumber = z
  .string()
  .trim()
  .regex(/^\d{4}\s*\/\s*\d{1,6}$/, "Numara \"YYYY/N\" biçiminde olmalıdır (örn. 2024/1183).");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır.");

/** POST /caselaw — avukatın elle karar girişi (ManualEntryAdapter). */
export const createCaseLawSchema = z.object({
  court: z.string().trim().min(3, "Mahkeme adı zorunludur (örn. \"Yargıtay 9. Hukuk Dairesi\")."),
  chamber: z.string().trim().min(1).optional(),
  caseNumber: docketNumber,
  decisionNumber: docketNumber,
  decisionDate: isoDate.optional(),
  summary: z.string().trim().min(1).max(4000).optional(),
  fullText: z.string().trim().min(1).max(200_000).optional(),
  sourceUrl: z.string().trim().url("Geçerli bir adres girin.").optional(),
});
export type CreateCaseLawInput = z.infer<typeof createCaseLawSchema>;

/** POST /caselaw/verify — Teyit Ajanı (deterministik, LLM YOK). */
export const verifyCitationsSchema = z.object({
  citations: z
    .array(z.string().trim().min(3))
    .min(1, "En az bir atıf gönderin.")
    .max(100, "Tek seferde en fazla 100 atıf doğrulanabilir."),
  /** PETITION | CHAT | ANALYSIS — verilirse sonuç CitationCheck'e yazılır. */
  sourceType: z.enum(["PETITION", "CHAT", "ANALYSIS"]).optional(),
  sourceId: z.string().trim().min(1).optional(),
});
export type VerifyCitationsInput = z.infer<typeof verifyCitationsSchema>;

/** POST /caselaw/ai-search — AI destekli arama (sorgu genişletme + özet). */
export const aiSearchSchema = z.object({
  question: z.string().trim().min(5, "Sorunuzu biraz daha açık yazın.").max(2000),
  caseId: z.string().uuid().optional(),
  /** Kaç sonucun AI ile özetleneceği (varsayılan 3, tavan 5 — maliyet kontrolü). */
  summarizeTop: z.number().int().min(0).max(5).optional(),
  /** KVKK 409 akışının ikinci turu. */
  piiApproved: z.boolean().optional(),
});
export type AiSearchInput = z.infer<typeof aiSearchSchema>;

/** POST /caselaw/:id/summarize */
export const summarizeCaseLawSchema = z.object({
  caseId: z.string().uuid().optional(),
  piiApproved: z.boolean().optional(),
});
export type SummarizeCaseLawInput = z.infer<typeof summarizeCaseLawSchema>;

/** POST /cases/:caseId/caselaw — dosyaya emsal bağla (status = ADAY). */
export const linkCaseLawSchema = z.object({
  caseLawId: z.string().uuid("Geçerli bir karar kimliği gönderin."),
  relevanceNote: z.string().trim().max(2000).optional(),
});
export type LinkCaseLawInput = z.infer<typeof linkCaseLawSchema>;

/** PATCH /caselaw-references/:id — ADAY → KABUL / RED. */
export const updateCaseLawReferenceSchema = z
  .object({
    status: z.enum(["ADAY", "KABUL", "RED"]).optional(),
    relevanceNote: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.status !== undefined || v.relevanceNote !== undefined, {
    message: "Güncellenecek bir alan gönderin (status veya relevanceNote).",
  });
export type UpdateCaseLawReferenceInput = z.infer<typeof updateCaseLawReferenceSchema>;
