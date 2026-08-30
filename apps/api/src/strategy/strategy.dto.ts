/**
 * Strateji modülü Zod GİRDİ şemaları — modül yereli (ortak karar 4).
 *
 * Çıktı şeması `strategy.chain.ts` içindedir; bu dosya yalnızca HTTP gövdelerini
 * doğrular.
 */

import { z } from "zod";
import { nullableText } from "../common/zod";

/** DB `StrategyNodeType` enum'u — elle düğüm ekleme/düzenlemede kullanılır. */
export const STRATEGY_NODE_TYPES = [
  "KARSI_ARGUMAN",
  "BIZIM_ARGUMAN",
  "DELIL",
  "HUKUKI_DAYANAK",
  "ZAYIF_NOKTA",
  "KARSI_CEVAP",
  "SENARYO",
  "RISK",
] as const;

export const createStrategySchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Strateji başlığı en az 3 karakter olmalıdır.")
    .max(200, "Strateji başlığı en fazla 200 karakter olabilir.")
    .optional(),
});
export type CreateStrategyInput = z.infer<typeof createStrategySchema>;

export const buildStrategySchema = z.object({
  /** Avukatın ek yönlendirmesi (opsiyonel). */
  instruction: z
    .string()
    .trim()
    .max(2000, "Yönlendirme en fazla 2000 karakter olabilir.")
    .optional(),
  /** KVKK 409 akışının ikinci turu. */
  piiApproved: z.boolean().optional(),
});
export type BuildStrategyInput = z.infer<typeof buildStrategySchema>;

export const createNodeSchema = z.object({
  nodeType: z.enum(STRATEGY_NODE_TYPES, {
    errorMap: () => ({ message: "Geçersiz düğüm türü." }),
  }),
  content: z
    .string()
    .trim()
    .min(3, "Düğüm içeriği en az 3 karakter olmalıdır.")
    .max(4000, "Düğüm içeriği en fazla 4000 karakter olabilir."),
  parentId: z.string().uuid("Üst düğüm geçerli bir kayıt kimliği olmalıdır.").nullable().optional(),
  strength: z
    .number()
    .int("Güç değeri tam sayı olmalıdır.")
    .min(1, "Güç değeri 1-5 arasında olmalıdır.")
    .max(5, "Güç değeri 1-5 arasında olmalıdır.")
    .nullable()
    .optional(),
  sourceRef: nullableText(500, "Dayanak izi"),
  orderIndex: z.number().int().min(0).max(9999).optional(),
});
export type CreateNodeInput = z.infer<typeof createNodeSchema>;

export const updateNodeSchema = createNodeSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  "Güncellenecek en az bir alan gönderilmelidir.",
);
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

/**
 * Elle bayatlatma / tazeleme.
 *
 * BAYAT durumu normalde SİSTEM tarafından tespit edilir (dosyaya yeni belge,
 * karar veya safahat kaydı düştüğünde). Avukat, yeniden üretmeden "bu gelişme
 * stratejiyi etkilemiyor" diyerek GUNCEL'e döndürebilir — bu bilinçli bir
 * karardır ve denetim kaydına yazılır.
 */
export const publishVersionSchema = z.object({
  summary: z
    .string()
    .trim()
    .max(4000, "Sürüm özeti en fazla 4000 karakter olabilir.")
    .optional(),
});
export type PublishVersionInput = z.infer<typeof publishVersionSchema>;

export const setStatusSchema = z.object({
  status: z.enum(["TASLAK", "GUNCEL", "BAYAT"], {
    errorMap: () => ({ message: "Geçersiz strateji durumu." }),
  }),
  reason: z
    .string()
    .trim()
    .max(500, "Gerekçe en fazla 500 karakter olabilir.")
    .optional(),
});
export type SetStatusInput = z.infer<typeof setStatusSchema>;
