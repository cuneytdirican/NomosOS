/**
 * Delil yönetimi Zod şemaları — modül yereli (ortak karar 4).
 *
 * ENUM DEĞERLERİ ŞEMADAN DEĞİL, PRISMA'DAN TÜRER: buradaki diziler
 * `packages/db/prisma/schema.prisma`'daki `ClaimSide`, `ClaimStatus`,
 * `EvidenceType`, `EvidenceStatus` enum'larının birebir kopyasıdır. İkisi
 * ayrışırsa Prisma yazma anında hata verir (sessiz kabul yoktur).
 */

import { z } from "zod";
import { nullableDate, nullableText, nullableUuid } from "../common/zod";

export const CLAIM_SIDES = ["BIZ", "KARSI_TARAF"] as const;
export const CLAIM_STATUSES = ["ACIK", "DESTEKLENIYOR", "ZAYIF", "CURUTULDU"] as const;
export const EVIDENCE_TYPES = [
  "BELGE",
  "FOTOGRAF",
  "VIDEO",
  "SES",
  "TANIK",
  "BILIRKISI",
  "KESIF",
  "DIGER",
] as const;
export const EVIDENCE_STATUSES = ["PLANLANAN", "TOPLANDI", "SUNULDU", "KABUL", "RED"] as const;

/** BELGE benzeri tipler: `documentId` beklenir (uyarı üretilir, engel değil). */
export const DOCUMENT_BACKED_TYPES = ["BELGE", "FOTOGRAF", "VIDEO", "SES"] as const;

/* ------------------------------- İddia ------------------------------- */

export const createClaimSchema = z.object({
  side: z.enum(CLAIM_SIDES, {
    errorMap: () => ({ message: "İddia tarafı BIZ veya KARSI_TARAF olmalıdır." }),
  }),
  text: z
    .string()
    .trim()
    .min(5, "İddia metni en az 5 karakter olmalıdır.")
    .max(4000, "İddia metni en fazla 4000 karakter olabilir."),
  /** Verilmezse dosyadaki son sıranın bir fazlası atanır. */
  orderIndex: z.number().int().min(0).max(9999).optional(),
  status: z.enum(CLAIM_STATUSES).optional(),
});
export type CreateClaimInput = z.infer<typeof createClaimSchema>;

export const updateClaimSchema = z
  .object({
    side: z.enum(CLAIM_SIDES).optional(),
    text: z.string().trim().min(5).max(4000).optional(),
    orderIndex: z.number().int().min(0).max(9999).optional(),
    status: z.enum(CLAIM_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Güncellenecek en az bir alan gerekir." });
export type UpdateClaimInput = z.infer<typeof updateClaimSchema>;

/* ------------------------------- Delil ------------------------------- */

export const createEvidenceSchema = z
  .object({
    type: z.enum(EVIDENCE_TYPES, {
      errorMap: () => ({
        message: `Delil tipi şunlardan biri olmalıdır: ${EVIDENCE_TYPES.join(", ")}`,
      }),
    }),
    title: z
      .string()
      .trim()
      .min(3, "Delil başlığı en az 3 karakter olmalıdır.")
      .max(300, "Delil başlığı en fazla 300 karakter olabilir."),
    description: nullableText(4000, "Açıklama"),
    /** DMS bağı — Document.id. Varlığı servis katmanında doğrulanır. */
    documentId: nullableUuid("Belge kimliği"),
    witnessName: nullableText(200, "Tanık adı"),
    obtainedAt: nullableDate("Elde edilme tarihi"),
    status: z.enum(EVIDENCE_STATUSES).optional(),
  })
  .superRefine((value, ctx) => {
    /**
     * TANIK delilinde tanık adı ZORUNLUDUR: adı olmayan bir tanık delili,
     * tanık listesi dilekçesinde satır üretemez ve matriste anlamsız durur
     * (docs/moduller/14, iş kuralı 2).
     */
    if (value.type === "TANIK" && !String(value.witnessName ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["witnessName"],
        message: "TANIK tipindeki delilde tanık adı zorunludur.",
      });
    }
  });
export type CreateEvidenceInput = z.infer<typeof createEvidenceSchema>;

export const updateEvidenceSchema = z
  .object({
    type: z.enum(EVIDENCE_TYPES).optional(),
    title: z.string().trim().min(3).max(300).optional(),
    description: nullableText(4000, "Açıklama"),
    documentId: nullableUuid("Belge kimliği"),
    witnessName: nullableText(200, "Tanık adı"),
    obtainedAt: nullableDate("Elde edilme tarihi"),
    status: z.enum(EVIDENCE_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Güncellenecek en az bir alan gerekir." });
export type UpdateEvidenceInput = z.infer<typeof updateEvidenceSchema>;

/* ------------------------- İddia ↔ delil bağı ------------------------- */

export const linkEvidenceSchema = z.object({
  /**
   * Destek gücü 1-5 — AVUKAT değerlendirmesidir. AI önerse bile bu alana
   * yazılan değer avukatın onayladığı değerdir.
   */
  strength: z.number().int().min(1, "Destek gücü 1-5 arasında olmalıdır.").max(5).optional(),
  note: nullableText(1000, "Not"),
});
export type LinkEvidenceInput = z.infer<typeof linkEvidenceSchema>;

/* ------------------------- Hukuki dayanak ---------------------------- */

export const addLegalBasisSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(3, "Hukuki dayanak en az 3 karakter olmalıdır.")
    .max(300, "Hukuki dayanak en fazla 300 karakter olabilir."),
  /**
   * İçtihat dayanağı KAYIT ÜZERİNDEN doğrulanır: verilirse
   * `CaseLawDocument` havuzunda aranır, bulunamazsa 422 döner.
   * LLM'e "bu karar var mı?" SORULMAZ (ürün ilkesi).
   */
  caseLawId: nullableUuid("İçtihat kimliği"),
  note: nullableText(1000, "Not"),
});
export type AddLegalBasisInput = z.infer<typeof addLegalBasisSchema>;

/* ------------------------------ AI uçları ---------------------------- */

export const evidenceAiSchema = z.object({
  /** Avukatın ek yönlendirmesi (opsiyonel). */
  question: nullableText(1000, "Yönlendirme"),
  /** KVKK 409 akışının ikinci turu. */
  piiApproved: z.boolean().optional(),
});
export type EvidenceAiInput = z.infer<typeof evidenceAiSchema>;
