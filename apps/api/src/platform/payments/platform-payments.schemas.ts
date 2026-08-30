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
export const refundRequestSchema = z.object({ reason: reasonField });
export type RefundRequestInput = z.infer<typeof refundRequestSchema>;
