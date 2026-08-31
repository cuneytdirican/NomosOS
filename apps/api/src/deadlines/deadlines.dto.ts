import { z } from "zod";
import { nullableText, nullableUuid } from "../common/zod";

/** Prisma ServiceMethod ile birebir. */
export const SERVICE_METHODS = ["ELDEN", "POSTA", "ETEBLIGAT", "DURUSMADA", "DIGER"] as const;
export type ServiceMethodValue = (typeof SERVICE_METHODS)[number];

/** PATCH ile izinli hedef durumlar. */
export const DEADLINE_TARGET_STATUSES = ["ONAYLANDI", "TAMAMLANDI", "IPTAL", "KACIRILDI"] as const;

/**
 * POST /deadlines — MANUEL süre kaydı.
 *
 * GÜVENLİK (denetim bulgusu 4): `source`, `ruleKey` ve `computeNote` alanları
 * bu şemadan KALDIRILMIŞTIR. Aksi hâlde herhangi bir kullanıcı
 * `source: "KURAL"` ve elle yazılmış bir `computeNote` göndererek, motor hiç
 * çalışmadan "kural motorundan üretilmiş" görünen sahte bir hesap izi
 * yaratabiliyordu; üstelik `update()` kural kaynaklı sürelerin son gününü
 * değiştirmeyi engellediği için bu sahte kayıt kilitleniyordu.
 *
 * Bu uçtan açılan her kayıt daima `source: "MANUEL"`dir; `computeNote` yalnızca
 * `createFromRule` tarafından, gerçek motor çıktısından üretilir.
 *
 * `status` da `BEKLIYOR | ONAYLANDI` ile sınırlandırılmıştır: aksi hâlde
 * doğrudan `TAMAMLANDI` / `KACIRILDI` / `IPTAL` yazarak `updateStatus`
 * içindeki rol kontrolleri atlanabiliyordu.
 */
export const CREATABLE_DEADLINE_STATUSES = ["BEKLIYOR", "ONAYLANDI"] as const;

export const createDeadlineSchema = z.object({
  caseId: z.string().uuid("Dosya seçilmelidir."),
  title: z.string().min(3, "Süre başlığı en az 3 karakter olmalıdır.").max(300, "Süre başlığı en fazla 300 karakter olabilir."),
  dueDate: z.coerce.date({ invalid_type_error: "Son gün geçerli bir tarih olmalıdır." }),
  ownerId: nullableUuid("Sorumlu"),
  legalBasis: nullableText(300, "Kanuni dayanak"),
  triggerDate: z.coerce.date({ invalid_type_error: "Tetikleyici tarih geçerli olmalıdır." }).optional(),
  serviceMethod: z.enum(SERVICE_METHODS, { errorMap: () => ({ message: "Geçersiz tebligat yöntemi." }) }).optional(),
  status: z
    .enum(CREATABLE_DEADLINE_STATUSES, {
      errorMap: () => ({ message: "Yeni süre yalnızca BEKLIYOR veya ONAYLANDI durumunda açılabilir." }),
    })
    .optional()
    .default("ONAYLANDI"),
});
export type CreateDeadlineInput = z.infer<typeof createDeadlineSchema>;

/** PATCH /deadlines/:id */
export const updateDeadlineSchema = z
  .object({
    title: z.string().min(3, "Süre başlığı en az 3 karakter olmalıdır.").max(300, "Süre başlığı en fazla 300 karakter olabilir.").optional(),
    dueDate: z.coerce.date({ invalid_type_error: "Son gün geçerli bir tarih olmalıdır." }).optional(),
    ownerId: nullableUuid("Sorumlu"),
    legalBasis: nullableText(300, "Kanuni dayanak"),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateDeadlineInput = z.infer<typeof updateDeadlineSchema>;

/**
 * PATCH /deadlines/:id/inputs — KURAL kaynaklı sürenin GİRDİSİNİ düzeltir
 * (denetim bulgusu K-14).
 *
 * NEDEN AYRI BİR UÇ. `PATCH /deadlines/:id` kural kaynaklı sürenin
 * `dueDate`'ini bilinçli olarak reddeder — son gün elle yazılabilseydi
 * "deterministik motor" iddiası çökerdi. Ama reddin verdiği tavsiye
 * ("tetikleyici tarihi düzeltip yeniden hesaplayın") üründe karşılıksızdı:
 * `updateDeadlineSchema` `triggerDate`/`serviceMethod` almıyordu ve avukatın
 * elinde yalnız kaydı SİLMEK kalıyordu; bu da hesap izini koparıyordu.
 *
 * Bu uç son günü İSTEMCİDEN ALMAZ: girdiyi alır, motoru yeniden koşturur ve
 * son günü motorun ürettiğini yazar. Yani düzeltme yolu açılırken motorun
 * tekelliği korunur.
 *
 * `reason` ZORUNLUDUR: girdi düzeltmesi, kayda geçmiş bir tespitin geri
 * alınmasıdır (Modül 04 KK8). Neyin niçin değiştiğini yazmayan bir düzeltme,
 * denetim izinde "sebepsiz tarih oynaması" olarak görünür.
 */
export const correctDeadlineInputsSchema = z
  .object({
    triggerDate: z.coerce.date({ invalid_type_error: "Tetikleyici tarih geçerli olmalıdır." }).optional(),
    serviceMethod: z
      .enum(SERVICE_METHODS, { errorMap: () => ({ message: "Geçersiz tebligat yöntemi." }) })
      .optional(),
    /**
     * HMK m.103 istisnası — `computeDeadlineSchema` ile aynı anlam.
     * Gönderilmezse kuralın kendi ayarı uygulanır.
     */
    applyJudicialRecess: z.boolean().optional(),
    reason: z
      .string()
      .trim()
      .min(10, "Düzeltme gerekçesi en az 10 karakter olmalıdır; bu kayıt denetim izinde kalır.")
      .max(2000, "Düzeltme gerekçesi en fazla 2000 karakter olabilir."),
  })
  .refine(
    (data) => data.triggerDate !== undefined || data.serviceMethod !== undefined || data.applyJudicialRecess !== undefined,
    "Düzeltilecek en az bir girdi (tetikleyici tarih, tebligat yöntemi veya adli tatil tercihi) gönderilmelidir."
  );
export type CorrectDeadlineInputsInput = z.infer<typeof correctDeadlineInputsSchema>;

/** PATCH /deadlines/:id/status */
export const updateDeadlineStatusSchema = z.object({
  status: z.enum(DEADLINE_TARGET_STATUSES, {
    errorMap: () => ({ message: "Süre durumu ONAYLANDI, TAMAMLANDI, KACIRILDI veya IPTAL olabilir." }),
  }),
  note: z.string().max(2000, "Not en fazla 2000 karakter olabilir.").optional(),
});
export type UpdateDeadlineStatusInput = z.infer<typeof updateDeadlineStatusSchema>;

/** POST /deadlines/compute — hesaplar, KAYDETMEZ. */
export const computeDeadlineSchema = z.object({
  ruleKey: z.string().min(1, "Kural anahtarı zorunludur.").max(80),
  triggerDate: z.coerce.date({ invalid_type_error: "Tetikleyici tarih (tebliğ/karar günü) geçerli olmalıdır." }),
  serviceMethod: z.enum(SERVICE_METHODS, { errorMap: () => ({ message: "Geçersiz tebligat yöntemi." }) }).optional(),
  caseId: z.string().uuid("Dosya geçerli bir kayıt olmalıdır.").optional(),
  /**
   * HMK m.103 İSTİSNASI GEÇERSİZ KILMA (opsiyonel).
   *
   * Adli tatil rejimi normalde KURALDAN gelir (DeadlineRule.judicialRecessApplies)
   * — istemciden değil. Bu alan yalnızca avukatın, kuralın varsayılanından
   * bilinçli olarak ayrılmasına imkân verir (ör. dosyanın HMK m.103 kapsamında
   * olduğunu tespit etmesi). Gönderilmezse kuralın kendi ayarı uygulanır.
   *
   * NOT: Eski `skipJudicialRecess` alanı KALDIRILMIŞTIR — adı yaptığı işin
   * tersini söylüyordu (`true` = "uygula") ve arayüze "adli tatili dikkate alma"
   * etiketiyle bağlanırsa sonuç sessizce tersine dönüyordu (denetim bulgusu 4).
   */
  applyJudicialRecess: z.boolean().optional(),
});
export type ComputeDeadlineInput = z.infer<typeof computeDeadlineSchema>;

/** POST /deadlines/from-rule — hesaplar VE Deadline kaydı oluşturur. */
export const deadlineFromRuleSchema = computeDeadlineSchema.extend({
  caseId: z.string().uuid("Dosya seçilmelidir."),
  title: z.string().min(3, "Süre başlığı en az 3 karakter olmalıdır.").max(300).optional(),
  ownerId: nullableUuid("Sorumlu"),
});
export type DeadlineFromRuleInput = z.infer<typeof deadlineFromRuleSchema>;
