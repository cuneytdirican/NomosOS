/**
 * İcra modülü Zod şemaları — modül yereli (ortak karar 8).
 *
 * PARA ALANLARI: tutarlar `string` olarak alınır ve `string` olarak Prisma'ya
 * verilir. `z.number()` kullanılmaz — JSON sayısı IEEE-754 çift duyarlıklıdır ve
 * 347500.10 gibi bir kuruş değeri yolda bozulabilir. Doğrulama düzenli ifadeyle
 * yapılır; aritmetik yalnızca `Prisma.Decimal` ile yürütülür.
 */

import { z } from "zod";
import { nullableDate, nullableText } from "../common/zod";
import { ENFORCEMENT_STAGES } from "./enforcement-stage";

export const ENFORCEMENT_TYPES = [
  "ILAMLI",
  "ILAMSIZ",
  "KAMBIYO",
  "REHNIN_PARAYA_CEVRILMESI",
  "IPOTEGIN_PARAYA_CEVRILMESI",
  "NAFAKA",
  "TAHLIYE",
] as const;

export const ENFORCEMENT_ACTION_TYPES = [
  "TAKIP_TALEBI",
  "ODEME_EMRI",
  "ITIRAZ",
  "ITIRAZIN_IPTALI",
  "HACIZ_TALEBI",
  "HACIZ_UYGULAMA",
  "KIYMET_TAKDIRI",
  "SATIS_TALEBI",
  "IHALE",
  "TAHSILAT",
  "HARC_ODEME",
  "MASRAF",
  "DIGER",
] as const;

export const ASSET_TYPES = [
  "TASINMAZ",
  "ARAC",
  "BANKA_HESABI",
  "MAAS",
  "ALACAK",
  "HISSE",
  "DIGER",
] as const;

export const ASSET_STATUSES = [
  "TESPIT_EDILDI",
  "HACZEDILDI",
  "SATISA_CIKARILDI",
  "SATILDI",
  "SERBEST_BIRAKILDI",
] as const;

export const COLLECTION_METHODS = [
  "BANKA",
  "KASA",
  "HACIZ_SATIS",
  "MAAS_KESINTISI",
  "ANLASMA",
  "DIGER",
] as const;

export const COPILOT_COMMANDS = [
  "MALVARLIGI_ANALIZ",
  "SONRAKI_ADIMLAR",
  "KACIRILAN_SURELER",
  "TAHSILAT_IHTIMALI",
  "ISLEM_GECMISI_ANALIZ",
  "ITIRAZ_KARSILASTIRMA",
] as const;
export type CopilotCommand = (typeof COPILOT_COMMANDS)[number];

/* ------------------------------------------------------------------ *
 * Para alanları
 * ------------------------------------------------------------------ */

/** En çok 16 tam + 2 ondalık basamak — Decimal(18,2) ile birebir. */
const MONEY_PATTERN = /^-?\d{1,16}(\.\d{1,2})?$/;

/**
 * Parasal alan. Sayı da kabul edilir (istemci kolaylığı) ama HEMEN string'e
 * çevrilir; bu noktadan sonra değer hiçbir yerde `number` olarak dolaşmaz.
 */
const money = (label: string, opts: { allowNegative?: boolean } = {}) =>
  z.preprocess(
    (v) => {
      if (typeof v === "number") return Number.isFinite(v) ? v.toFixed(2) : String(v);
      if (typeof v === "string") return v.trim().replace(",", ".");
      return v;
    },
    z
      .string({ required_error: `${label} zorunludur.`, invalid_type_error: `${label} sayısal olmalıdır.` })
      .regex(MONEY_PATTERN, `${label} en fazla iki ondalık basamaklı bir tutar olmalıdır (örn. 12500.00).`)
      .refine((v) => opts.allowNegative || !v.startsWith("-"), `${label} negatif olamaz.`),
  );

const optionalMoney = (label: string) =>
  z.preprocess(
    (v) => (v === "" || v === null ? null : v),
    money(label).nullable().optional(),
  );

/** Yüzde alanı (faiz oranı) — Decimal(5,2), 0-999.99. */
const percent = (label: string) =>
  z.preprocess(
    (v) => {
      if (v === "" || v === null) return null;
      if (typeof v === "number") return Number.isFinite(v) ? String(v) : v;
      if (typeof v === "string") return v.trim().replace(",", ".");
      return v;
    },
    z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, `${label} 0 ile 999,99 arasında, en fazla iki ondalıklı olmalıdır.`)
      .nullable()
      .optional(),
  );

/* ------------------------------------------------------------------ *
 * İcra dosyası
 * ------------------------------------------------------------------ */

/** POST /enforcement */
export const createEnforcementSchema = z.object({
  caseId: z.string().uuid("Dosya kimliği geçerli olmalıdır."),
  officeName: z
    .string()
    .min(3, "İcra dairesi adı en az 3 karakter olmalıdır.")
    .max(200, "İcra dairesi adı en fazla 200 karakter olabilir."),
  fileNumber: z
    .string()
    .min(1, "İcra dosya numarası zorunludur.")
    .max(50, "İcra dosya numarası en fazla 50 karakter olabilir."),
  trackingType: z.enum(ENFORCEMENT_TYPES, { errorMap: () => ({ message: "Geçersiz takip tipi." }) }),
  principalAmount: money("Asıl alacak"),
  interestRate: percent("Faiz oranı"),
  currency: z.string().length(3, "Para birimi 3 harfli olmalıdır (örn. TRY).").optional().default("TRY"),
  requestDate: z.coerce.date({ invalid_type_error: "Takip talebi tarihi geçerli olmalıdır." }),
  paymentOrderServedAt: nullableDate("Ödeme emri tebliğ tarihi"),
  debtorInfo: nullableText(4000, "Borçlu bilgisi"),
});
export type CreateEnforcementInput = z.infer<typeof createEnforcementSchema>;

/** PATCH /enforcement/:id — aşama BURADAN değiştirilemez (ayrı uç, kural kapısı var). */
export const updateEnforcementSchema = z
  .object({
    officeName: z.string().min(3).max(200).optional(),
    fileNumber: z.string().min(1).max(50).optional(),
    trackingType: z.enum(ENFORCEMENT_TYPES, { errorMap: () => ({ message: "Geçersiz takip tipi." }) }).optional(),
    principalAmount: money("Asıl alacak").optional(),
    interestRate: percent("Faiz oranı"),
    currency: z.string().length(3).optional(),
    requestDate: z.coerce.date().optional(),
    paymentOrderServedAt: nullableDate("Ödeme emri tebliğ tarihi"),
    objectionDate: nullableDate("İtiraz tarihi"),
    finalizedAt: nullableDate("Kesinleşme tarihi"),
    debtorInfo: nullableText(4000, "Borçlu bilgisi"),
  })
  .refine((d) => Object.keys(d).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateEnforcementInput = z.infer<typeof updateEnforcementSchema>;

/** PATCH /enforcement/:id/stage */
export const changeStageSchema = z.object({
  stage: z.enum(ENFORCEMENT_STAGES, { errorMap: () => ({ message: "Geçersiz icra aşaması." }) }),
  note: z.string().max(2000, "Gerekçe en fazla 2000 karakter olabilir.").optional(),
  /**
   * KAPANDI aşamasında bakiye sıfır değilse zorunlu (Modül 05 kural 9):
   * "aciz vesikası var" ya da "takipten vazgeçildi" gibi avukat gerekçesi.
   */
  closureReason: z.string().max(2000, "Kapanış gerekçesi en fazla 2000 karakter olabilir.").optional(),
});
export type ChangeStageInput = z.infer<typeof changeStageSchema>;

/* ------------------------------------------------------------------ *
 * Safahat (aksiyon)
 * ------------------------------------------------------------------ */

export const createActionSchema = z.object({
  type: z.enum(ENFORCEMENT_ACTION_TYPES, { errorMap: () => ({ message: "Geçersiz icra işlem türü." }) }),
  date: z.coerce.date({ invalid_type_error: "İşlem tarihi geçerli olmalıdır." }),
  description: z
    .string()
    .min(3, "İşlem açıklaması en az 3 karakter olmalıdır.")
    .max(4000, "İşlem açıklaması en fazla 4000 karakter olabilir."),
  amount: optionalMoney("İşlem tutarı"),
  resultNote: nullableText(4000, "Sonuç notu"),
});
export type CreateActionInput = z.infer<typeof createActionSchema>;

export const updateActionSchema = z
  .object({
    type: z.enum(ENFORCEMENT_ACTION_TYPES, { errorMap: () => ({ message: "Geçersiz icra işlem türü." }) }).optional(),
    date: z.coerce.date().optional(),
    description: z.string().min(3).max(4000).optional(),
    amount: optionalMoney("İşlem tutarı"),
    resultNote: nullableText(4000, "Sonuç notu"),
  })
  .refine((d) => Object.keys(d).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateActionInput = z.infer<typeof updateActionSchema>;

/* ------------------------------------------------------------------ *
 * Malvarlığı
 * ------------------------------------------------------------------ */

export const createAssetSchema = z.object({
  assetType: z.enum(ASSET_TYPES, { errorMap: () => ({ message: "Geçersiz malvarlığı türü." }) }),
  description: z
    .string()
    .min(2, "Malvarlığı açıklaması en az 2 karakter olmalıdır.")
    .max(2000, "Malvarlığı açıklaması en fazla 2000 karakter olabilir."),
  estimatedValue: optionalMoney("Tahmini değer"),
  status: z.enum(ASSET_STATUSES, { errorMap: () => ({ message: "Geçersiz malvarlığı durumu." }) }).optional(),
  discoveredAt: z.coerce.date({ invalid_type_error: "Tespit tarihi geçerli olmalıdır." }),
  note: nullableText(2000, "Not"),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = z
  .object({
    assetType: z.enum(ASSET_TYPES, { errorMap: () => ({ message: "Geçersiz malvarlığı türü." }) }).optional(),
    description: z.string().min(2).max(2000).optional(),
    estimatedValue: optionalMoney("Tahmini değer"),
    status: z.enum(ASSET_STATUSES, { errorMap: () => ({ message: "Geçersiz malvarlığı durumu." }) }).optional(),
    discoveredAt: z.coerce.date().optional(),
    note: nullableText(2000, "Not"),
  })
  .refine((d) => Object.keys(d).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

/* ------------------------------------------------------------------ *
 * Tahsilat
 * ------------------------------------------------------------------ */

export const createCollectionSchema = z.object({
  amount: money("Tahsilat tutarı"),
  date: z.coerce.date({ invalid_type_error: "Tahsilat tarihi geçerli olmalıdır." }),
  method: z.enum(COLLECTION_METHODS, { errorMap: () => ({ message: "Geçersiz tahsilat yöntemi." }) }),
  note: nullableText(2000, "Not"),
  /**
   * Tahsilat, müvekkil cari hesabına FinancialEntry (TAHSILAT) olarak yansır.
   * Varsayılan açıktır; muhasebeye ayrıca işlenecekse kapatılabilir.
   */
  createFinancialEntry: z.boolean().optional().default(true),
});
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

/* ------------------------------------------------------------------ *
 * Copilot
 * ------------------------------------------------------------------ */

export const copilotSchema = z.object({
  command: z.enum(COPILOT_COMMANDS, {
    errorMap: () => ({
      message: `Geçersiz komut. Geçerli komutlar: ${COPILOT_COMMANDS.join(", ")}.`,
    }),
  }),
  /** Serbest soru — komuta ek talimat olarak iletilir. */
  question: z.string().max(2000, "Soru en fazla 2000 karakter olabilir.").optional(),
  /** ISLEM_GECMISI_ANALIZ için incelenecek son işlem sayısı. */
  lastN: z.coerce.number().int().min(1).max(100).optional(),
  /** KVKK 409 akışının ikinci turu: avukat maskeli metni onayladı. */
  piiApproved: z.boolean().optional().default(false),
});
export type CopilotInput = z.infer<typeof copilotSchema>;

/** POST /enforcement/:id/deadlines/suggest */
export const suggestDeadlinesSchema = z.object({
  /**
   * true → hesaplanan süreler Deadline kaydı olarak (status=BEKLIYOR) açılır.
   * false → yalnızca hesap döner, hiçbir kayıt yazılmaz (önizleme).
   */
  persist: z.boolean().optional().default(false),
  ownerId: z.string().uuid("Sorumlu kimliği geçerli olmalıdır.").optional(),
});
export type SuggestDeadlinesInput = z.infer<typeof suggestDeadlinesSchema>;
