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
