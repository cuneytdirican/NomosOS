/**
 * Vekaletname modülü Zod şemaları — modül yereli.
 */

import { z } from "zod";
import { nullableDate, nullableText, nullableUuid } from "../common/zod";
import { POA_SCOPE_CODES } from "./poa-scope-catalog";

export const POA_TYPES = ["GENEL", "OZEL", "BOSANMA", "CEZA", "ICRA", "SIRKET", "DIGER"] as const;

/**
 * Kapsam maddesi girişi. `code` katalogdan gelir; `DIGER` seçildiğinde
 * serbest açıklama (`note`) ZORUNLUDUR — aksi hâlde "diğer bir yetki var"
 * diyen ama neyi olduğunu söylemeyen bir kayıt oluşurdu.
 */
export const scopeItemSchema = z
  .object({
    code: z.enum(POA_SCOPE_CODES, {
      errorMap: () => ({ message: "Yetki kodu katalogda tanımlı değil." }),
    }),
    present: z.boolean().default(true),
    note: nullableText(500, "Yetki açıklaması"),
  })
  .refine((v) => v.code !== "DIGER" || (typeof v.note === "string" && v.note.trim().length >= 3), {
    message: '"Diğer" yetkisi seçildiğinde açıklama girilmesi zorunludur.',
    path: ["note"],
  });
export type ScopeItemInput = z.infer<typeof scopeItemSchema>;

const scopeItemsField = z
  .array(scopeItemSchema)
  .max(POA_SCOPE_CODES.length, "Aynı yetki listesi birden çok kez gönderilemez.")
  .optional();

export const createPoaSchema = z.object({
  clientId: z.string().uuid("Müvekkil kimliği geçerli bir kayıt kimliği olmalıdır."),
  /** Vekaletname belirli bir dosyaya bağlıysa. Boş bırakılabilir. */
  caseId: nullableUuid("Dosya kimliği"),
  type: z.enum(POA_TYPES).optional(),
  notary: nullableText(200, "Noter adı"),
  /** Yevmiye numarası. */
  number: nullableText(60, "Yevmiye numarası"),
  issuedAt: z.coerce.date({
    required_error: "Düzenleme tarihi zorunludur.",
    invalid_type_error: "Düzenleme tarihi geçerli bir tarih olmalıdır.",
  }),
  /** Boş = SÜRESİZ vekaletname. */
  expiresAt: nullableDate("Bitiş tarihi"),
  /** Vekaletnamenin kapsam metni (OCR veya elle girilen). AI analizinin girdisi. */
  scope: nullableText(20000, "Kapsam metni"),
  scopeItems: scopeItemsField,
  documentId: nullableUuid("Belge kimliği"),
});
export type CreatePoaInput = z.infer<typeof createPoaSchema>;

export const updatePoaSchema = z
  .object({
    caseId: nullableUuid("Dosya kimliği"),
    type: z.enum(POA_TYPES).optional(),
    notary: nullableText(200, "Noter adı"),
    number: nullableText(60, "Yevmiye numarası"),
    issuedAt: z.coerce.date().optional(),
    expiresAt: nullableDate("Bitiş tarihi"),
    scope: nullableText(20000, "Kapsam metni"),
    scopeItems: scopeItemsField,
    documentId: nullableUuid("Belge kimliği"),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Güncellenecek en az bir alan gerekir." });
export type UpdatePoaInput = z.infer<typeof updatePoaSchema>;

/**
 * AZİL / İSTİFA / SÜRE DOLUMU.
 *
 * Ayrı bir uçtur çünkü geri alınamaz bir hukuki sonuç doğurur ve rol kapısı
 * PATCH'ten farklıdır (SEKRETER kayıt açabilir, sonlandıramaz).
 */
export const revokePoaSchema = z.object({
  /** Azil/istifa tebliğ tarihi. Boş bırakılırsa bugün alınır. */
  revokedAt: nullableDate("Azil tarihi"),
  reason: z
    .string()
    .trim()
    .min(3, "Azil/istifa gerekçesi en az 3 karakter olmalıdır.")
    .max(2000, "Azil/istifa gerekçesi en fazla 2000 karakter olabilir."),
  /** AZIL = müvekkil azletti · ISTIFA = vekil çekildi · SURE_DOLUMU. */
  terminationType: z.enum(["AZIL", "ISTIFA", "SURE_DOLUMU"]).default("AZIL"),
});
export type RevokePoaInput = z.infer<typeof revokePoaSchema>;

/** POST /power-of-attorney/:id/scope-check */
export const poaScopeCheckSchema = z.object({
  caseId: z.string().uuid("Dosya kimliği geçerli bir kayıt kimliği olmalıdır."),
  /** Avukatın özel sorusu — ör. "sulh teklifini kabul edebilir miyim?". */
  question: nullableText(1000, "Soru"),
  /** KVKK 409 akışının ikinci turu. */
  piiApproved: z.boolean().optional(),
});
export type PoaScopeCheckInput = z.infer<typeof poaScopeCheckSchema>;
