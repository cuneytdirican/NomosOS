/**
 * Sözleşme modülü Zod şemaları — modül yereli.
 */

import { z } from "zod";
import { SIGNATURE_METHODS, SIGNER_ROLES } from "@nomosos/e-signature";
import { nullableDate, nullableText, nullableUuid } from "../common/zod";

export const CONTRACT_TYPES = [
  "VEKALET_UCRET",
  "DANISMANLIK",
  "GIZLILIK",
  "HIZMET",
  "DIGER",
] as const;

export const CONTRACT_STATUSES = [
  "TASLAK",
  "MUZAKERE",
  "IMZAYA_HAZIR",
  "IMZADA",
  "YURURLUKTE",
  "SONA_ERDI",
  "FESIH",
] as const;

/* --------------------------- Sözleşme ----------------------------- */

export const createContractSchema = z.object({
  clientId: nullableUuid("Müvekkil kimliği"),
  caseId: nullableUuid("Dosya kimliği"),
  title: z
    .string()
    .trim()
    .min(3, "Sözleşme başlığı en az 3 karakter olmalıdır.")
    .max(300, "Sözleşme başlığı en fazla 300 karakter olabilir."),
  type: z.enum(CONTRACT_TYPES, {
    errorMap: () => ({ message: "Sözleşme tipi geçersiz." }),
  }),
  effectiveFrom: nullableDate("Yürürlük başlangıcı"),
  effectiveTo: nullableDate("Yürürlük bitişi"),
  /** Fesih ihbar süresi (gün). Deterministik süre hesabının girdisidir. */
  renewalNoticeDays: z
    .number()
    .int("Fesih ihbar süresi tam sayı olmalıdır.")
    .min(1, "Fesih ihbar süresi en az 1 gün olabilir.")
    .max(365, "Fesih ihbar süresi en fazla 365 gün olabilir.")
    .nullable()
    .optional(),
  /** Kendiliğinden yenileme hükmü — YALNIZCA BİLGİDİR, sistem yenileme yapmaz. */
  autoRenew: z.boolean().optional(),
  /** İlk sürümün metni. Verilirse v1 sürümü birlikte açılır. */
  contentText: nullableText(500_000, "Sözleşme metni"),
  documentId: nullableUuid("Belge kimliği"),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;

export const updateContractSchema = z
  .object({
    clientId: nullableUuid("Müvekkil kimliği"),
    caseId: nullableUuid("Dosya kimliği"),
    title: z.string().trim().min(3).max(300).optional(),
    type: z.enum(CONTRACT_TYPES).optional(),
    effectiveFrom: nullableDate("Yürürlük başlangıcı"),
    effectiveTo: nullableDate("Yürürlük bitişi"),
    renewalNoticeDays: z.number().int().min(1).max(365).nullable().optional(),
    autoRenew: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Güncellenecek en az bir alan gerekir." });
export type UpdateContractInput = z.infer<typeof updateContractSchema>;

/**
 * Durum geçişi. YURURLUKTE'ye çıkarken imzalı belge yoksa `manualApproval`
 * ve gerekçe ZORUNLUDUR — "sistem kendiliğinden yürürlük vermez" kuralının
 * gövdedeki karşılığı.
 */
export const transitionContractSchema = z.object({
  toStatus: z.enum(CONTRACT_STATUSES, {
    errorMap: () => ({ message: "Hedef durum geçersiz." }),
  }),
  /** İmzalı nüsha olmadan yürürlüğe alma onayı (ıslak imza, elden teslim vb.). */
  manualApproval: z.boolean().optional(),
  note: nullableText(2000, "Açıklama"),
});
export type TransitionContractInput = z.infer<typeof transitionContractSchema>;

/* ---------------------------- Sürümler ---------------------------- */

export const createVersionSchema = z.object({
  contentText: z
    .string()
    .trim()
    .min(20, "Sürüm metni en az 20 karakter olmalıdır.")
    .max(500_000, "Sürüm metni en fazla 500.000 karakter olabilir."),
  changeNote: nullableText(2000, "Değişiklik notu"),
  documentId: nullableUuid("Belge kimliği"),
  /** Bu sürüm sözleşmenin güncel sürümü olsun mu (varsayılan: evet). */
  makeCurrent: z.boolean().optional(),
});
export type CreateVersionInput = z.infer<typeof createVersionSchema>;

/* ---------------------------- E-imza ------------------------------ */

export const signerInputSchema = z.object({
  fullName: z.string().trim().min(3, "İmzacı adı en az 3 karakter olmalıdır.").max(200),
  email: z.string().trim().email("İmzacı e-posta adresi geçerli değil.").max(320),
  phone: nullableText(30, "Telefon numarası"),
  role: z.enum(SIGNER_ROLES, { errorMap: () => ({ message: "İmzacı rolü geçersiz." }) }),
  order: z.number().int().min(1).max(20).optional(),
  method: z.enum(SIGNATURE_METHODS).optional(),
});
export type SignerInput = z.infer<typeof signerInputSchema>;

export const createSignatureRequestSchema = z.object({
  /** İmzalanacak sürüm. Boş bırakılırsa sözleşmenin güncel sürümü kullanılır. */
  versionId: nullableUuid("Sürüm kimliği"),
  method: z.enum(SIGNATURE_METHODS, {
    errorMap: () => ({ message: "İmza yöntemi geçersiz (NES, MOBIL_IMZA, E_DEVLET, SAGLAYICI_ICI)." }),
  }),
  signers: z
    .array(signerInputSchema)
    .min(1, "İmza süreci başlatmak için en az bir imzacı gereklidir.")
    .max(20, "Bir imza sürecinde en fazla 20 imzacı olabilir."),
  sequential: z.boolean().optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  subject: nullableText(300, "Davet konusu"),
  message: nullableText(4000, "Davet mesajı"),
});
export type CreateSignatureRequestInput = z.infer<typeof createSignatureRequestSchema>;

export const cancelSignatureRequestSchema = z.object({
  reason: nullableText(1000, "İptal gerekçesi"),
});
export type CancelSignatureRequestInput = z.infer<typeof cancelSignatureRequestSchema>;

/* ------------------------- AI incelemesi -------------------------- */

export const reviewContractSchema = z.object({
  /** İncelenecek sürüm. Boş bırakılırsa güncel sürüm incelenir. */
  versionId: nullableUuid("Sürüm kimliği"),
  /** Müvekkilimiz sözleşmenin hangi tarafı — inceleme onun lehine yapılır. */
  ourParty: nullableText(200, "Müvekkilimizin taraf sıfatı"),
  /** Avukatın yönlendirmesi (ör. "cezai şart ve fesih maddelerine odaklan"). */
  focus: nullableText(1000, "Odak"),
  /** KVKK 409 akışının ikinci turu. */
  piiApproved: z.boolean().optional(),
});
export type ReviewContractInput = z.infer<typeof reviewContractSchema>;
