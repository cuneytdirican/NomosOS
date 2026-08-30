/** Risk Motoru Zod GİRDİ şemaları — modül yereli (ortak karar 4). */

import { z } from "zod";

export const RISK_DIMENSIONS_ALL = [
  "GENEL",
  "HUKUKI",
  "SURE",
  "DELIL",
  "TAHSILAT",
  "USUL",
  "ICTIHAT",
  "KARSI_TARAF",
] as const;

export const RISK_BANDS = ["DUSUK", "ORTA", "YUKSEK"] as const;

export const computeRiskSchema = z.object({
  /**
   * AI değerlendirmesi çalıştırılsın mı?
   *
   * Varsayılan TRUE'dur ama motor AI'sız da ÇALIŞIR (Faz 4.1): sağlayıcı yoksa
   * veya çağrı başarısız olursa deterministik skorlar yine yazılır ve uyarı
   * döner — "skorsuz dosya kalmaz" (Modül 17, iş kuralı 9).
   */
  useAi: z.boolean().optional(),
  /** KVKK 409 akışının ikinci turu. */
  piiApproved: z.boolean().optional(),
});
export type ComputeRiskInput = z.infer<typeof computeRiskSchema>;

/**
 * Bant override — GEREKÇE ZORUNLUDUR.
 *
 * Gerekçesiz override, risk motorunu sessizce kapatmanın yoludur; bu yüzden
 * `reason` şemada zorunlu ve asgari uzunluğa tabidir.
 */
export const overrideRiskSchema = z.object({
  dimension: z.enum(RISK_DIMENSIONS_ALL, {
    errorMap: () => ({ message: "Geçersiz risk boyutu." }),
  }),
  band: z.enum(RISK_BANDS, {
    errorMap: () => ({ message: "Geçersiz risk bandı (DUSUK / ORTA / YUKSEK)." }),
  }),
  reason: z
    .string()
    .trim()
    .min(10, "Override gerekçesi en az 10 karakter olmalıdır; gerekçesiz ezme kabul edilmez.")
    .max(1000, "Gerekçe en fazla 1000 karakter olabilir."),
  /** Boş bırakılırsa süresizdir. */
  expiresAt: z.coerce
    .date({ invalid_type_error: "Geçerlilik bitişi geçerli bir tarih olmalıdır." })
    .optional(),
});
export type OverrideRiskInput = z.infer<typeof overrideRiskSchema>;
