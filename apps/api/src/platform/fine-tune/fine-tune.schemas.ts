import { z } from "zod";

/** D5 / M4 — fine-tuning işi şemaları. */

export const fineTuneCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "İş adı en az 3 karakter olmalıdır.")
    .max(120, "İş adı en fazla 120 karakter olabilir."),
  provider: z
    .string()
    .trim()
    .min(2, "Sağlayıcı adı zorunludur (örn. OpenAI, Yerel vLLM).")
    .max(120, "Sağlayıcı adı en fazla 120 karakter olabilir."),
  baseModel: z
    .string()
    .trim()
    .min(2, "Temel model zorunludur (örn. gpt-4o-mini).")
    .max(200, "Temel model adı en fazla 200 karakter olabilir."),
  note: z.string().trim().max(2000, "Not en fazla 2000 karakter olabilir.").optional(),
});
export type FineTuneCreateInput = z.infer<typeof fineTuneCreateSchema>;

/**
 * Durum geçiş şeridi — sağlayıcıya otomatik gönderim YOKTUR; geçişleri
 * operatör ELLE yapar (manifesti kendisi yüklemiştir).
 * TAMAMLANDI için resultModelName ZORUNLUDUR.
 */
export const FINE_TUNE_TRANSITIONS: Record<string, readonly string[]> = {
  HAZIRLANDI: ["GONDERILDI", "IPTAL"],
  GONDERILDI: ["EGITILIYOR", "BASARISIZ", "IPTAL"],
  EGITILIYOR: ["TAMAMLANDI", "BASARISIZ"],
  TAMAMLANDI: [],
  BASARISIZ: [],
  IPTAL: [],
};

export const fineTuneStatusSchema = z.object({
  status: z.enum(["GONDERILDI", "EGITILIYOR", "TAMAMLANDI", "BASARISIZ", "IPTAL"]),
  resultModelName: z
    .string()
    .trim()
    .max(200, "Sonuç model adı en fazla 200 karakter olabilir.")
    .optional(),
  note: z.string().trim().max(2000).optional(),
});
export type FineTuneStatusInput = z.infer<typeof fineTuneStatusSchema>;
