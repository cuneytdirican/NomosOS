/** Modül 08 — Finans modülünün yerel Zod şemaları. */

import { z } from "zod";
import { nullableDate, nullableText, nullableUuid } from "../common/zod";
import { currencyCode, nullablePercentRate, positiveMoney } from "./money.zod";

/** Prisma `FinancialEntryType` ile birebir. */
export const FINANCIAL_ENTRY_TYPES = [
  "TAHAKKUK",
  "TAHSILAT",
  "AVANS",
  "MASRAF",
  "HARC",
  "VEKALET_UCRETI",
  "DANISMANLIK",
  "IADE",
] as const;
export type FinancialEntryTypeValue = (typeof FINANCIAL_ENTRY_TYPES)[number];

export const FINANCIAL_ENTRY_TYPE_LABELS: Record<FinancialEntryTypeValue, string> = {
  TAHAKKUK: "Tahakkuk",
  TAHSILAT: "Tahsilat",
  AVANS: "Avans",
  MASRAF: "Masraf",
  HARC: "Harç",
  VEKALET_UCRETI: "Vekâlet ücreti",
  DANISMANLIK: "Danışmanlık ücreti",
  IADE: "İade",
};

/**
 * TAHAKKUK NİTELİĞİNDEKİ TİPLER — müvekkil alacağını ARTIRAN kalemler.
 * Bakiye formülünün payı budur (Modül 08, iş kuralı 2).
 */
export const ACCRUAL_TYPES = ["TAHAKKUK", "VEKALET_UCRETI", "DANISMANLIK"] as const;

/** Tahsilat niteliğindeki tipler — müvekkil alacağını AZALTAN kalemler. */
export const COLLECTION_TYPES = ["TAHSILAT"] as const;

/** Masraf ve harç: büro cebinden çıkan, yansıtılabilir/yansıtılamaz giderler. */
export const COST_TYPES = ["MASRAF", "HARC"] as const;

/** POST /finance/entries */
export const createFinancialEntrySchema = z.object({
  clientId: z.string().uuid("Müvekkil geçerli bir kayıt kimliği olmalıdır."),
  caseId: nullableUuid("Dosya"),
  type: z.enum(FINANCIAL_ENTRY_TYPES, { errorMap: () => ({ message: "Geçersiz finans hareketi tipi." }) }),
  amount: positiveMoney("Tutar"),
  currency: currencyCode(),
  date: z.coerce.date({ invalid_type_error: "Hareket tarihi geçerli bir tarih olmalıdır." }).optional(),
  description: nullableText(1000, "Açıklama"),
  /**
   * Masraf/harç müvekkile yansıtılacak mı?
   * `false` ⇒ kalem AVANSTAN MAHSUP edilmiş sayılır (bkz. finance.service.ts,
   * avans bakiyesi kontrolü).
   */
  isBillable: z.boolean().optional().default(true),
  vatRate: nullablePercentRate("KDV oranı"),
});
export type CreateFinancialEntryInput = z.infer<typeof createFinancialEntrySchema>;

/** PATCH /finance/entries/:id */
export const updateFinancialEntrySchema = z
  .object({
    caseId: nullableUuid("Dosya"),
    type: z.enum(FINANCIAL_ENTRY_TYPES, { errorMap: () => ({ message: "Geçersiz finans hareketi tipi." }) }).optional(),
    amount: positiveMoney("Tutar").optional(),
    currency: z
      .preprocess(
        (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
        z.string().regex(/^[A-Z]{3}$/, "Para birimi üç harfli ISO kodu olmalıdır."),
      )
      .optional(),
    date: z.coerce.date({ invalid_type_error: "Hareket tarihi geçerli bir tarih olmalıdır." }).optional(),
    description: nullableText(1000, "Açıklama"),
    isBillable: z.boolean().optional(),
    vatRate: nullablePercentRate("KDV oranı"),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateFinancialEntryInput = z.infer<typeof updateFinancialEntrySchema>;

/** POST /finance/ask — CLIENT_FINANCIAL_SUMMARY */
export const financeAskSchema = z.object({
  question: z
    .string()
    .min(3, "Soru en az 3 karakter olmalıdır.")
    .max(500, "Soru en fazla 500 karakter olabilir."),
  /** Boşsa büro geneli özet anlatılır. */
  clientId: nullableUuid("Müvekkil"),
  /** KVKK onay bayrağı — dış sağlayıcıya maskeli metin gönderimi için. */
  piiApproved: z.boolean().optional().default(false),
});
export type FinanceAskInput = z.infer<typeof financeAskSchema>;

/** Liste süzgeçleri (query string). */
export interface FinanceEntryListParams {
  clientId?: string;
  caseId?: string;
  type?: string;
  currency?: string;
  from?: string;
  to?: string;
  /** "true" → yalnız faturalanmış, "false" → yalnız faturalanmamış. */
  invoiced?: string;
  isBillable?: string;
  page?: string;
  limit?: string;
}

/** Dönem parametresi — büro raporunda kullanılır. */
export const nullablePeriodDate = nullableDate("Dönem tarihi");
