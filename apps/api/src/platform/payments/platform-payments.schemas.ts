import { z } from "zod";
import { reasonField } from "../tenants/platform-tenants.schemas";

/**
 * İade talebi.
 *
 * Tutar alanı BİLİNÇLİ OLARAK YOKTUR: kısmi iade bu fazda desteklenmez, çünkü
 * kısmi iade tutarının doğrulanması (kalan bakiye, önceki kısmi iadeler)
 * gerçek sağlayıcı mutabakatı olmadan güvenilir biçimde yapılamaz. İade,
 * kaydın TAMAMI üzerinden işaretlenir.
 */
export const refundRequestSchema = z.object({
  reason: reasonField,
  /**
   * F2-Ö-37: kısmi iade tutarı. Gönderilmezse TAM iade uygulanır — bu bilinçli
   * bir davranıştır. Eski şemada alan YOKTU; panel gönderiyordu ama sunucu
   * sessizce düşürüyor ve HER TALEP TAM İADE oluyordu.
   */
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Kısmi iade tutarı sayı olmalı (örn. 150.00).")
    .optional(),
});
export type RefundRequestInput = z.infer<typeof refundRequestSchema>;
