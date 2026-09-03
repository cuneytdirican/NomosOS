import { z } from "zod";
import { CLIENT_TYPES, isValidTckn } from "@nomosos/shared";
import { nullableEmail, nullableText } from "../common/zod";

/** PATCH /clients/:id — tüm alanlar opsiyonel; null gönderimi alanı temizler. */
export const updateClientSchema = z
  .object({
    type: z.enum(CLIENT_TYPES, { errorMap: () => ({ message: "Müvekkil türü GERCEK_KISI veya TUZEL_KISI olmalıdır." }) }).optional(),
    name: z.string().min(2, "Ad/unvan en az 2 karakter olmalıdır.").max(300, "Ad/unvan en fazla 300 karakter olabilir.").optional(),
    tckn: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z
        .string()
        .nullable()
        .optional()
        .refine((v) => !v || isValidTckn(v), "Geçersiz TC Kimlik No.")
    ),
    taxNumber: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().regex(/^\d{10}$/, "Vergi numarası 10 haneli olmalıdır.").nullable().optional()
    ),
    taxOffice: nullableText(120, "Vergi dairesi"),
    email: nullableEmail(),
    phone: nullableText(30, "Telefon"),
    address: nullableText(1000, "Adres"),
    iban: nullableText(40, "IBAN"),
    notes: nullableText(5000, "Notlar"),
    category: nullableText(100, "Kategori"),
    referenceCode: nullableText(50, "Referans kodu"),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

/** A1 (rakip analizi) — CSV içe aktarma gövdesi. */
export const importCsvSchema = z.object({
  csv: z
    .string()
    .min(10, "CSV metni çok kısa — en az bir başlık ve bir satır gerekir.")
    .max(500_000, "CSV metni 500 KB'ı aşamaz; parça parça gönderin."),
});
export type ImportCsvInput = z.infer<typeof importCsvSchema>;

/**
 * D6 — mükerrer müvekkil birleştirme (Modül 01 kural 10).
 * Hedef kart URL'dedir (:id); gövde taşınacak KAYNAK kartı verir.
 */
export const mergeClientSchema = z.object({
  sourceClientId: z.string().uuid("Birleştirilecek (kaynak) müvekkil kimliği geçersiz."),
});
export type MergeClientInput = z.infer<typeof mergeClientSchema>;

/**
 * D6-B — mükerrer tespiti: yeni kayıt öncesi canlı uyarı.
 * Kaydı ENGELLEMEZ (tam TCKN/VKN eşleşmesi ayrı ve 409'dur); avukatın kararıdır.
 */
export const duplicateCheckSchema = z.object({
  name: z.string().trim().min(2, "Tespit için ad zorunludur.").max(300),
  tckn: z.string().trim().max(11).optional(),
  taxNumber: z.string().trim().max(10).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(30).optional(),
});
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

/**
 * D7/M3 — müvekkil segment kataloğu (kiracı bazlı YÖNETİLEN liste).
 * Client.category bu listeden seçilir; kod sabiti değil büronun segmentasyonu.
 */
export const createSegmentSchema = z.object({
  label: z
    .string()
    .trim()
    .min(2, "Segment adı en az 2 karakter olmalıdır.")
    .max(60, "Segment adı en fazla 60 karakter olabilir."),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});
export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;

export const updateSegmentSchema = z
  .object({
    label: z.string().trim().min(2).max(60).optional(),
    sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Güncellenecek en az bir alan gönderin.");
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;

/** POST /clients/:id/contacts */
export const createContactSchema = z.object({
  fullName: z.string().min(2, "İlgili kişi adı en az 2 karakter olmalıdır.").max(200, "İlgili kişi adı en fazla 200 karakter olabilir."),
  title: nullableText(120, "Görev/unvan"),
  email: nullableEmail(),
  phone: nullableText(30, "Telefon"),
  notes: nullableText(2000, "Notlar"),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

/** PATCH /clients/:id/contacts/:contactId */
export const updateContactSchema = z.object({
  fullName: z.string().min(2, "İlgili kişi adı en az 2 karakter olmalıdır.").max(200, "İlgili kişi adı en fazla 200 karakter olabilir.").optional(),
  title: nullableText(120, "Görev/unvan"),
  email: nullableEmail(),
  phone: nullableText(30, "Telefon"),
  notes: nullableText(2000, "Notlar"),
});
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
