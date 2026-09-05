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
import { nullableInterestRate, nullableMoney, positiveMoney } from "../finance/money.zod";
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
 * Para alanları — TEK KAYNAK: finance/money.zod.ts
 * ------------------------------------------------------------------ */

/**
 * PARA DOĞRULAMASI FİNANS MODÜLÜYLE ORTAKTIR.
 *
 * Buradaki yerel `money` yardımcısı sayı girdisinde
 * `Number.isFinite(v) ? v.toFixed(2) : ...` yapıyordu ve iki kusuru vardı
 * (denetim bulgusu 9):
 *
 *   (a) `12500.999` REDDEDİLMİYOR, sessizce `"12501.00"` oluyordu — kullanıcı
 *       1 kuruş değil 1 TL fark yediğini görmüyordu;
 *   (b) `Number.prototype.toFixed` ikili gösterime bağlıdır:
 *       `(1.005).toFixed(2) === "1.00"` — yani modülün `money.ts:30`'da
 *       tavizsiz uyguladığı ROUND_HALF_UP kuralına AYKIRI yuvarlıyordu.
 *
 * `finance/money.zod.ts` doğru davranıyor: değeri metne çevirip iki ondalıktan
 * fazlasını REDDEDİYOR. İki modülün para sınırı aynı sözleşmeye uymalıdır;
 * fazla basamak yuvarlanmaz, reddedilir. Bu yüzden yerel yardımcılar silindi
 * ve tek kapı bırakıldı.
 */
const money = (label: string) => positiveMoney(label);

const optionalMoney = (label: string) => nullableMoney(label);

/** Faiz oranı — Decimal(5,2), 0-999,99 (gecikme faizi %100'ü aşabilir). */
const percent = (label: string) => nullableInterestRate(label);

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
  /** Faz 6: YASAL/AVANS/TICARI_TEMERRUT → dönem tablosu; boş = sabit interestRate. */
  interestKind: z.enum(["YASAL", "AVANS", "TICARI_TEMERRUT"]).nullable().optional(),
  currency: z.string().length(3, "Para birimi 3 harfli olmalıdır (örn. TRY).").optional().default("TRY"),
  requestDate: z.coerce.date({ invalid_type_error: "Takip talebi tarihi geçerli olmalıdır." }),
  /** Faiz başlangıcı (temerrüt/vade/ihtar). Boşsa takip talebi tarihi kullanılır. */
  interestStartDate: nullableDate("Faiz başlangıç tarihi"),
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
    interestKind: z.enum(["YASAL", "AVANS", "TICARI_TEMERRUT"]).nullable().optional(),
    currency: z.string().length(3).optional(),
    requestDate: z.coerce.date().optional(),
    /**
     * Faiz başlangıcı (temerrüt/vade/ihtar; ilamlı takipte ilam tarihi).
     * Boşsa hesap takip talebi tarihinden işletilir ve bakiye UYARI döndürür.
     */
    interestStartDate: nullableDate("Faiz başlangıç tarihi"),
    paymentOrderServedAt: nullableDate("Ödeme emri tebliğ tarihi"),
    objectionDate: nullableDate("İtiraz tarihi"),
    finalizedAt: nullableDate("Kesinleşme tarihi"),
    debtorInfo: nullableText(4000, "Borçlu bilgisi"),
    /**
     * Tahsilat kaydı bulunan dosyada parasal çapaları (asıl alacak, faiz
     * oranı/başlangıcı, takip tarihi, para birimi) değiştirmek için ZORUNLU.
     * Bakiye türetilmiş bir değerdir; çapa değişimi geçmiş hesabı da değiştirir.
     */
    changeReason: z.string().max(2000, "Gerekçe en fazla 2000 karakter olabilir.").optional(),
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
  /**
   * ÖDEME EMRİ TEBLİĞ TARİHİ — ODEME_EMRI_TEBLIG aşamasına geçişte zorunludur.
   *
   * Aşamanın hukuki anlamı bu tarihe bağlıdır: İİK m.62 (kambiyoda m.168/5)
   * itiraz süresi YALNIZCA `paymentOrderServedAt` doluyken tetiklenir. Tarih
   * çapalanmadığında süre hiç hesaplanmıyor, hiç önerilmiyor ve "eksik süre"
   * listesinde bile görünmüyordu — sessiz hak kaybı (denetim bulgusu 7).
   * `ITIRAZ`/`KAPANDI` için zaten uygulanan desenin aynısı.
   */
  servedAt: nullableDate("Ödeme emri tebliğ tarihi"),
  /**
   * KESİNLEŞME ÖN KOŞULUNU BİLEREK AŞMA GEREKÇESİ.
   *
   * İtiraz süresi dolmadan takip kesinleştirilemez (İİK m.62). Avukat yine de
   * kesinleştirmek istiyorsa (ör. borçlu itirazdan feragat etti) gerekçe
   * ZORUNLUDUR ve AuditLog'a yazılır — `closureReason` deseninin aynısı.
   */
  overrideReason: z.string().max(2000, "Gerekçe en fazla 2000 karakter olabilir.").optional(),
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
