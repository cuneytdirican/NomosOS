/**
 * Sözleşme Analizi ve Simülasyon Zod şemaları — modül yereli.
 */

import { z } from "zod";
import { nullableText, nullableUuid } from "../common/zod";

export const CONTRACT_ANALYSIS_MODES = ["ILK", "REVIZYON", "NIHAI"] as const;

/**
 * Analiz koşusu. REVIZYON: yeni sürüm metni üzerinde inceleme — önceki açık
 * şerhler SUPERSEDED olur. NIHAI: imza öncesi kontrol — HUKUKI roller.
 */
export const runContractAnalysisSchema = z.object({
  /** İncelenecek sürüm. Boş bırakılırsa güncel sürüm incelenir. */
  versionId: nullableUuid("Sürüm kimliği"),
  mode: z.enum(CONTRACT_ANALYSIS_MODES, {
    errorMap: () => ({ message: "Analiz modu geçersiz (ILK, REVIZYON, NIHAI)." }),
  }),
  /** Müvekkilimizin taraf sıfatı — her iki perspektifin yönünü belirler. */
  ourParty: nullableText(200, "Müvekkilimizin taraf sıfatı"),
  /** Avukatın yönlendirmesi (ör. "cezai şart ve yetki maddelerine odaklan"). */
  focus: nullableText(1000, "Odak"),
  /** KVKK 409 akışının ikinci turu. */
  piiApproved: z.boolean().optional(),
});
export type RunContractAnalysisInput = z.infer<typeof runContractAnalysisSchema>;

/** Şerh kapatma — GEREKÇE ZORUNLUDUR: "kapattım" denetim değeri taşımaz. */
export const closeAnnotationSchema = z.object({
  note: z
    .string()
    .trim()
    .min(5, "Şerh kapatma gerekçesi en az 5 karakter olmalıdır.")
    .max(2000, "Şerh kapatma gerekçesi en fazla 2000 karakter olabilir."),
});
export type CloseAnnotationInput = z.infer<typeof closeAnnotationSchema>;

/**
 * Sürüm farkı — iki sürüm kimliği; A = eski, B = yeni.
 * Sonuç SAYFALANMIŞ döner: yalnızca DEĞİŞEN sayfalar listelenir
 * (`page`/`limit` fark sayfaları üzerinde gezinir).
 */
export const contractDiffSchema = z
  .object({
    versionAId: z.string().uuid("Eski sürüm kimliği geçerli bir UUID olmalıdır."),
    versionBId: z.string().uuid("Yeni sürüm kimliği geçerli bir UUID olmalıdır."),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .refine((v) => v.versionAId !== v.versionBId, {
    message: "Bir sürüm kendisiyle karşılaştırılamaz.",
  });
export type ContractDiffInput = z.infer<typeof contractDiffSchema>;

/** Müvekkile kritik şerh bildirimi — özet SUNUCUDA deterministik kurulur. */
export const notifyClientSchema = z.object({
  /** Bildirim metnine avukat notu (isteğe bağlı). */
  note: nullableText(2000, "Avukat notu"),
});
export type NotifyClientInput = z.infer<typeof notifyClientSchema>;

export const CONTRACT_NOTIFY_MODES = ["MANUAL", "OTOMATIK"] as const;

/** Otomatik bildirim kipi — açma PARTNER+ yetkisidir (denetim izine yazılır). */
export const setNotifyModeSchema = z.object({
  mode: z.enum(CONTRACT_NOTIFY_MODES, {
    errorMap: () => ({ message: "Bildirim kipi geçersiz (MANUAL, OTOMATIK)." }),
  }),
});
export type SetNotifyModeInput = z.infer<typeof setNotifyModeSchema>;
