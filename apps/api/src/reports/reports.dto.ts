/**
 * Raporlama uçlarının gövde şemaları (Zod).
 *
 * `params` serbest bir sözlüktür ama SINIRSIZ DEĞİLDİR: anahtar sayısı ve
 * değerlerin tipi kısıtlanır. Sınırsız bırakıldığında `paramsJson` alanına
 * megabaytlarca metin yazılabilir ve her kayıtlı rapor listesi onu geri okurdu.
 * Değerler yalnız ilkel tip ya da ilkel dizisi olabilir — iç içe nesne, rapor
 * parametresi olarak anlamlı değildir ve JSON derinliği bir saldırı yüzeyidir.
 */

import { z } from "zod";

const paramPrimitive = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

export const reportParamsSchema = z
  .record(z.union([paramPrimitive, z.array(paramPrimitive).max(20)]))
  .refine((obj) => Object.keys(obj).length <= 30, {
    message: "Rapor filtresi en fazla 30 alan içerebilir.",
  })
  .default({});

export const createSavedReportSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Kayıtlı rapor adı zorunludur.")
    .max(120, "Kayıtlı rapor adı en fazla 120 karakter olabilir."),
  reportKey: z.string().trim().min(1, "Rapor anahtarı zorunludur.").max(80),
  params: reportParamsSchema,
  scope: z.enum(["KISISEL", "BURO"]).default("KISISEL"),
  isPinned: z.boolean().default(false),
});
export type CreateSavedReportInput = z.infer<typeof createSavedReportSchema>;

export const updateSavedReportSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    params: reportParamsSchema.optional(),
    scope: z.enum(["KISISEL", "BURO"]).optional(),
    isPinned: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Güncellenecek en az bir alan gönderilmelidir.",
  });
export type UpdateSavedReportInput = z.infer<typeof updateSavedReportSchema>;

export const runSavedReportSchema = z.object({
  /** Kayıtlı filtreyi geçici olarak ezen alanlar (kayıt DEĞİŞMEZ). */
  params: reportParamsSchema,
});
export type RunSavedReportInput = z.infer<typeof runSavedReportSchema>;

export const interpretReportSchema = z.object({
  params: reportParamsSchema,
  /**
   * Yorumun odaklanması istenen soru. LLM'e BİREBİR gider; KVKK maskeleme
   * kapısından geçer (bkz. reports-ai.service.ts veri minimizasyonu beyanı).
   */
  soru: z.string().trim().max(500, "Soru en fazla 500 karakter olabilir.").optional(),
  /** Dış sağlayıcıya maskeli gönderim onayı (KVKK kapısı 409 döndüyse). */
  piiApproved: z.boolean().optional(),
});
export type InterpretReportInput = z.infer<typeof interpretReportSchema>;
