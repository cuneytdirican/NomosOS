/** Modül 09 — Faturalama modülünün yerel Zod şemaları. */

import { z } from "zod";
import { nullableDate, nullableText, nullableUuid } from "../common/zod";
import {
  currencyCode,
  nullableMoney,
  nullablePercentRate,
  percentRate,
  positiveMoney,
  quantityValue,
} from "../finance/money.zod";

/* ==================================================================== *
 * 1) ÜCRET SÖZLEŞMESİ
 * ==================================================================== */

/** Prisma `FeeType` ile birebir. */
export const FEE_TYPES = [
  "SABIT",
  "SAATLIK",
  "BASARI_PRIMI",
  "DOSYA_BAZLI",
  "AYLIK_DANISMANLIK",
  "KARMA",
] as const;
export type FeeTypeValue = (typeof FEE_TYPES)[number];

/** Prisma `AgreementStatus` ile birebir. */
export const AGREEMENT_STATUSES = ["TASLAK", "AKTIF", "SONA_ERDI", "FESIH"] as const;

/** Saat ücreti taşıyabilen sözleşme tipleri (fatura üretiminde tarife kaynağı). */
export const HOURLY_FEE_TYPES: readonly FeeTypeValue[] = ["SAATLIK", "KARMA"];

/**
 * TİP BAZLI ZORUNLULUK MATRİSİ (Modül 09, kullanıcı hikâyesi 1).
 *   SABIT / DOSYA_BAZLI / AYLIK_DANISMANLIK → `amount` zorunlu
 *   SAATLIK                                  → `hourlyRate` zorunlu
 *   BASARI_PRIMI                             → `successPercent` zorunlu
 *   KARMA                                    → `amount` VEYA `hourlyRate` (en az biri)
 */
function refineFeeAgreement(
  data: { type?: string; amount?: string | null; hourlyRate?: string | null; successPercent?: string | null },
  ctx: z.RefinementCtx,
): void {
  const has = (v: string | null | undefined) => v !== null && v !== undefined && v !== "";
  switch (data.type) {
    case "SABIT":
    case "DOSYA_BAZLI":
    case "AYLIK_DANISMANLIK":
      if (!has(data.amount)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["amount"],
          message: "Bu sözleşme tipinde sözleşme bedeli (amount) zorunludur.",
        });
      }
      break;
    case "SAATLIK":
      if (!has(data.hourlyRate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["hourlyRate"],
          message: "Saatlik sözleşmede saat ücreti (hourlyRate) zorunludur.",
        });
      }
      break;
    case "BASARI_PRIMI":
      if (!has(data.successPercent)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["successPercent"],
          message: "Başarı primli sözleşmede prim oranı (successPercent) zorunludur.",
        });
      }
      break;
    case "KARMA":
      if (!has(data.amount) && !has(data.hourlyRate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["amount"],
          message: "Karma sözleşmede sabit bedel veya saat ücretinden en az biri zorunludur.",
        });
      }
      break;
  }
}

export const createFeeAgreementSchema = z
  .object({
    clientId: z.string().uuid("Müvekkil geçerli bir kayıt kimliği olmalıdır."),
    caseId: nullableUuid("Dosya"),
    type: z.enum(FEE_TYPES, { errorMap: () => ({ message: "Geçersiz ücret sözleşmesi tipi." }) }),
    amount: nullableMoney("Sözleşme bedeli"),
    hourlyRate: nullableMoney("Saat ücreti"),
    successPercent: nullablePercentRate("Başarı primi oranı"),
    currency: currencyCode(),
    /** KDV oranı KODA GÖMÜLÜ DEĞİL: sözleşmede saklanır, faturaya oradan taşınır. */
    vatRate: percentRate("KDV oranı").optional(),
    startDate: z.coerce.date({ invalid_type_error: "Başlangıç tarihi geçerli olmalıdır." }),
    endDate: nullableDate("Bitiş tarihi"),
    terms: nullableText(5000, "Sözleşme koşulları"),
    status: z.enum(AGREEMENT_STATUSES).optional().default("TASLAK"),
  })
  .superRefine(refineFeeAgreement);
export type CreateFeeAgreementInput = z.infer<typeof createFeeAgreementSchema>;

export const updateFeeAgreementSchema = z
  .object({
    caseId: nullableUuid("Dosya"),
    type: z.enum(FEE_TYPES, { errorMap: () => ({ message: "Geçersiz ücret sözleşmesi tipi." }) }).optional(),
    amount: nullableMoney("Sözleşme bedeli"),
    hourlyRate: nullableMoney("Saat ücreti"),
    successPercent: nullablePercentRate("Başarı primi oranı"),
    vatRate: percentRate("KDV oranı").optional(),
    startDate: z.coerce.date({ invalid_type_error: "Başlangıç tarihi geçerli olmalıdır." }).optional(),
    endDate: nullableDate("Bitiş tarihi"),
    terms: nullableText(5000, "Sözleşme koşulları"),
    status: z.enum(AGREEMENT_STATUSES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateFeeAgreementInput = z.infer<typeof updateFeeAgreementSchema>;

/* ==================================================================== *
 * 2) ZAMAN KAYDI
 * ==================================================================== */

/** 24 saat = 1440 dakika; tek kayıtta bir günden fazla süre girilemez. */
export const MAX_TIME_ENTRY_MINUTES = 1440;

export const createTimeEntrySchema = z
  .object({
    /** Boşsa oturum sahibinin kendi kaydı oluşturulur. */
    userId: nullableUuid("Kullanıcı"),
    caseId: nullableUuid("Dosya"),
    clientId: nullableUuid("Müvekkil"),
    date: z.coerce.date({ invalid_type_error: "Tarih geçerli olmalıdır." }),
    minutes: z
      .number({ invalid_type_error: "Süre dakika cinsinden tam sayı olmalıdır." })
      .int("Süre dakika cinsinden tam sayı olmalıdır.")
      .min(1, "Süre en az 1 dakika olmalıdır.")
      .max(MAX_TIME_ENTRY_MINUTES, `Tek kayıtta en fazla ${MAX_TIME_ENTRY_MINUTES} dakika girilebilir.`),
    description: z
      .string()
      .min(3, "Açıklama en az 3 karakter olmalıdır.")
      .max(1000, "Açıklama en fazla 1000 karakter olabilir."),
    billable: z.boolean().optional().default(true),
    /** Boşsa faturalama anında ücret sözleşmesinden çözülür. */
    hourlyRate: nullableMoney("Saat ücreti"),
  })
  .refine(
    (data) => Boolean(data.caseId) || Boolean(data.clientId),
    "Zaman kaydı için dosya veya müvekkilden en az biri seçilmelidir.",
  );
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;

export const updateTimeEntrySchema = z
  .object({
    caseId: nullableUuid("Dosya"),
    clientId: nullableUuid("Müvekkil"),
    date: z.coerce.date({ invalid_type_error: "Tarih geçerli olmalıdır." }).optional(),
    minutes: z
      .number()
      .int("Süre dakika cinsinden tam sayı olmalıdır.")
      .min(1, "Süre en az 1 dakika olmalıdır.")
      .max(MAX_TIME_ENTRY_MINUTES, `Tek kayıtta en fazla ${MAX_TIME_ENTRY_MINUTES} dakika girilebilir.`)
      .optional(),
    description: z.string().min(3).max(1000).optional(),
    billable: z.boolean().optional(),
    hourlyRate: nullableMoney("Saat ücreti"),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;

/* ==================================================================== *
 * 3) FATURA
 * ==================================================================== */

/** `InvoiceLine.sourceType` — şemada serbest string; burada kısıtlanır. */
export const INVOICE_LINE_SOURCE_TYPES = ["TIME_ENTRY", "FEE_AGREEMENT", "EXPENSE", "MANUEL"] as const;
export type InvoiceLineSourceType = (typeof INVOICE_LINE_SOURCE_TYPES)[number];

/** Prisma `InvoiceStatus` ile birebir. */
export const INVOICE_STATUSES = [
  "TASLAK",
  "GONDERILDI",
  "KISMI_ODENDI",
  "ODENDI",
  "IPTAL",
  "IADE",
] as const;

export const invoiceLineSchema = z.object({
  description: z
    .string()
    .min(2, "Satır açıklaması en az 2 karakter olmalıdır.")
    .max(500, "Satır açıklaması en fazla 500 karakter olabilir."),
  quantity: quantityValue("Miktar"),
  unitPrice: positiveMoney("Birim fiyat"),
  vatRate: percentRate("KDV oranı"),
  sourceType: z.enum(INVOICE_LINE_SOURCE_TYPES).optional().default("MANUEL"),
  sourceId: nullableUuid("Kaynak kayıt"),
});
export type InvoiceLineInputDto = z.infer<typeof invoiceLineSchema>;

export const createInvoiceSchema = z.object({
  clientId: z.string().uuid("Müvekkil geçerli bir kayıt kimliği olmalıdır."),
  issueDate: z.coerce.date({ invalid_type_error: "Düzenleme tarihi geçerli olmalıdır." }).optional(),
  dueDate: nullableDate("Vade tarihi"),
  currency: currencyCode(),
  note: nullableText(2000, "Not"),
  lines: z
    .array(invoiceLineSchema)
    .min(1, "Fatura en az bir satır içermelidir.")
    .max(200, "Bir faturada en fazla 200 satır olabilir."),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z
  .object({
    issueDate: z.coerce.date({ invalid_type_error: "Düzenleme tarihi geçerli olmalıdır." }).optional(),
    dueDate: nullableDate("Vade tarihi"),
    note: nullableText(2000, "Not"),
    /** Verilirse satırlar tamamen değiştirilir ve toplamlar yeniden hesaplanır. */
    lines: z.array(invoiceLineSchema).min(1).max(200).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

/** POST /billing/invoices/from-time-entries */
export const invoiceFromTimeEntriesSchema = z
  .object({
    clientId: z.string().uuid("Müvekkil geçerli bir kayıt kimliği olmalıdır."),
    from: z.coerce.date({ invalid_type_error: "Başlangıç tarihi geçerli olmalıdır." }),
    to: z.coerce.date({ invalid_type_error: "Bitiş tarihi geçerli olmalıdır." }),
    /** Boşsa aralıktaki TÜM faturalanmamış ve faturalanabilir kayıtlar alınır. */
    timeEntryIds: z.array(z.string().uuid()).max(500).optional(),
    caseId: nullableUuid("Dosya"),
    issueDate: z.coerce.date().optional(),
    dueDate: nullableDate("Vade tarihi"),
    note: nullableText(2000, "Not"),
    /** Sözleşmede oran yoksa kullanılacak KDV oranı. */
    vatRate: percentRate("KDV oranı").optional(),
  })
  .refine((data) => data.from <= data.to, {
    path: ["to"],
    message: "Bitiş tarihi başlangıç tarihinden önce olamaz.",
  });
export type InvoiceFromTimeEntriesInput = z.infer<typeof invoiceFromTimeEntriesSchema>;

export const finalizeInvoiceSchema = z
  .object({
    /** Fatura numarası seri ön eki (varsayılan: INVOICE_NUMBER_PREFIX ya da "NOM"). */
    seriesPrefix: z
      .string()
      .regex(/^[A-Z]{2,4}$/, "Seri ön eki 2-4 büyük harf olmalıdır.")
      .optional(),
    dueDate: nullableDate("Vade tarihi"),
  })
  .optional()
  .default({});
export type FinalizeInvoiceInput = z.infer<typeof finalizeInvoiceSchema>;

export const cancelInvoiceSchema = z.object({
  reason: z
    .string()
    .min(3, "İptal gerekçesi en az 3 karakter olmalıdır.")
    .max(500, "İptal gerekçesi en fazla 500 karakter olabilir."),
});
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;

/* ==================================================================== *
 * 4) ÖDEME
 * ==================================================================== */

/** Prisma `PaymentMethod` ile birebir. */
export const PAYMENT_METHODS = [
  "HAVALE",
  "KREDI_KARTI",
  "NAKIT",
  "CEK",
  "SENET",
  "MAHSUP",
  "DIGER",
] as const;

export const createPaymentSchema = z.object({
  clientId: z.string().uuid("Müvekkil geçerli bir kayıt kimliği olmalıdır."),
  /** Boşsa serbest tahsilat (avansa/cari hesaba) olarak kaydedilir. */
  invoiceId: nullableUuid("Fatura"),
  amount: positiveMoney("Tahsilat tutarı"),
  date: z.coerce.date({ invalid_type_error: "Tahsilat tarihi geçerli olmalıdır." }),
  method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "Geçersiz ödeme yöntemi." }) }),
  reference: nullableText(120, "Dekont/işlem referansı"),
  note: nullableText(1000, "Not"),
  /** Fazla ödemeyi bilerek kabul etmek için. */
  allowOverpayment: z.boolean().optional().default(false),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
