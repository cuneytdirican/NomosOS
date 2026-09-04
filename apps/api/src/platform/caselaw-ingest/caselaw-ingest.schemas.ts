import { z } from "zod";
import { poolRecordSchema } from "../caselaw-pool/caselaw-pool.schemas";

/**
 * İÇTİHAT TOPLAMA HATTI ŞEMALARI (caselaw-ingest).
 *
 * Besleme kayıt biçimi havuz içe aktarma kaydıyla BİREBİR AYNIdır
 * (poolRecordSchema) — iki doğrulama katmanı asla ayrışamaz; ayrışırsa
 * kuyrukta kabul edilen kayıt havuza girerken reddedilirdi.
 */

/** Besleme yanıtı: { records: PoolRecord[] } (+ opsiyonel üst veri yok sayılır). */
export const feedResponseSchema = z.object({
  records: z.array(poolRecordSchema).max(500),
});
export type FeedResponse = z.infer<typeof feedResponseSchema>;

/** Kaynak yapılandırması kaydetme/güncelleme (upsert, anahtar: key). */
export const sourceUpsertSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, "Kaynak anahtarı en az 2 karakter olmalıdır.")
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Kaynak anahtarı yalnız BÜYÜK harf, rakam ve alt çizgi olabilir."),
  name: z.string().trim().min(3, "Kaynak adı en az 3 karakter olmalıdır.").max(120),
  baseUrl: z.string().trim().url("Besleme adresi geçerli bir URL olmalıdır.").max(500),
  isEnabled: z.boolean().default(true),
  note: z.string().trim().max(300, "Kaynak notu en fazla 300 karakter olabilir.").optional(),
});
export type SourceUpsertInput = z.infer<typeof sourceUpsertSchema>;

/** Kuyruk listesi süzgeçleri. */
export const ingestItemsQuerySchema = z.object({
  status: z.enum(["BEKLIYOR", "ONAYLANDI", "REDDEDILDI"]).optional(),
  sourceKey: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type IngestItemsQuery = z.infer<typeof ingestItemsQuerySchema>;

/** Red gerekçesi ZORUNLU — sebepsiz red denetim izinde "neden" bırakamaz. */
export const ingestRejectSchema = z.object({
  reason: z.string().trim().min(3, "Red gerekçesi en az 3 karakter olmalıdır.").max(500),
});
export type IngestRejectInput = z.infer<typeof ingestRejectSchema>;
