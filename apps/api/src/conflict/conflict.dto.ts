/**
 * Çatışma kontrolü Zod şemaları — modül yereli (ortak karar 4).
 */

import { z } from "zod";
import { nullableText } from "../common/zod";

export const CONFLICT_DECISIONS = ["DEVAM", "REDDEDILDI", "BEKLEMEDE"] as const;
export type ConflictDecisionInput = (typeof CONFLICT_DECISIONS)[number];

export const runConflictCheckSchema = z.object({
  /** Taranacak ad/unvan (girildiği hâliyle saklanır). */
  query: z
    .string()
    .trim()
    .min(2, "Taranacak ad en az 2 karakter olmalıdır.")
    .max(200, "Taranacak ad en fazla 200 karakter olabilir."),
  /** Hangi iş için tarandığı (dava konusu, sektör) — AI çıkarımına da girer. */
  context: nullableText(500, "Bağlam"),
  /**
   * AI çıkarım katmanı (CONFLICT_INFERENCE) çalıştırılsın mı?
   * Varsayılan KAPALI: deterministik katman tek başına kayıt üretmeye yeter,
   * AI yalnızca "olası bağlı şirket" gibi nitel bir ek katmandır ve krediyle
   * ücretlendirilir.
   */
  useAi: z.boolean().optional().default(false),
  /** KVKK 409 akışının ikinci turu (yalnız useAi=true iken anlamlı). */
  piiApproved: z.boolean().optional(),
});
export type RunConflictCheckInput = z.infer<typeof runConflictCheckSchema>;

export const decideConflictSchema = z.object({
  decision: z.enum(CONFLICT_DECISIONS, {
    errorMap: () => ({ message: "Karar DEVAM, REDDEDILDI veya BEKLEMEDE olmalıdır." }),
  }),
  /**
   * GEREKÇE ZORUNLUDUR. Bu kayıt, ileride "bu müvekkili alırken çatışmayı
   * biliyor muyduk?" sorusunun denetim kanıtıdır; gerekçesiz karar kaydı
   * denetim değeri taşımaz (docs/moduller/11, iş kuralı 6).
   */
  note: z
    .string()
    .trim()
    .min(10, "Karar gerekçesi en az 10 karakter olmalıdır; gerekçesiz karar kaydedilemez.")
    .max(2000, "Karar gerekçesi en fazla 2000 karakter olabilir."),
});
export type DecideConflictInput = z.infer<typeof decideConflictSchema>;
