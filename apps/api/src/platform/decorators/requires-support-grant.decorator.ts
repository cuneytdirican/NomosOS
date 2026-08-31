import { SetMetadata } from "@nestjs/common";
import type { SupportScope } from "@nomosos/db";

export const SUPPORT_GRANT_KEY = "platform:support-grant";

export interface SupportGrantMeta {
  /** Ucun gerektirdiği asgari kapsam. */
  scope: SupportScope;
  /** Kiracı kimliğini taşıyan rota parametresi (varsayılan `id`). */
  paramName: string;
}

/**
 * DESTEK ERİŞİM PENCERESİ ZORUNLULUĞU — denetim bulgusu Ö-06.
 *
 * `SUPPORT_AGENT` rolünün bu ucu kullanabilmesi için ilgili kiracıya ait
 * AKTİF ve SÜRESİ DOLMAMIŞ bir `SupportAccessGrant` kaydı olmalıdır. Diğer
 * roller etkilenmez: onların erişimi destek talebine değil, göreve bağlıdır.
 *
 * Kapsam hiyerarşisi `support/support-grant.ts` içindedir.
 */
export const RequiresSupportGrant = (scope: SupportScope, paramName = "id") =>
  SetMetadata<string, SupportGrantMeta>(SUPPORT_GRANT_KEY, { scope, paramName });
