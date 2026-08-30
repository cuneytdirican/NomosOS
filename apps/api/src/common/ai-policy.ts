/**
 * TENANT AI POLİTİKASI KAPISI (docs/04-kvkk-veri-guvenligi.md).
 *
 * `Tenant.aiPolicy = SADECE_YEREL` seçen bir büro "verilerim büro ağının dışına
 * çıkmasın" der. Bu, tek bir ayarla verilebilecek bir garantidir ve rota
 * çözümünün ÜÇ AYRI kopyasında da (AiRunnerService, AssistantLlmService,
 * AgentRunnerService) uygulanmalıdır — aksi hâlde yanlışlıkla eklenmiş bir
 * ANTHROPIC sağlayıcısı sessizce yedek rota olur.
 *
 * DIŞSALLIK TİPE DEĞİL ADRESE BAKARAK belirlenir (`isExternalDestination`):
 * `CUSTOM` ve `OLLAMA` tipleri de kiracının serbestçe girdiği bir `baseUrl`
 * taşır ve bulut adresine bakıyor olabilir.
 */

import { UnprocessableEntityException } from "@nestjs/common";
import { isExternalDestination } from "@nomosos/ai";
import type { PrismaService } from "../prisma/prisma.service";

/** Sağlayıcı kaydının dışsallık kararı için gereken asgari alanlar. */
export interface ProviderRouteInfo {
  type: string;
  baseUrl?: string | null;
  name?: string;
}

export const LOCAL_ONLY_MESSAGE =
  "Büronuzun AI politikası SADECE_YEREL. Seçilen sağlayıcının adresi büro ağının dışında " +
  "olduğu için istek yapılmadı. Yerel bir sağlayıcı (Ollama veya büro içi bir adres) " +
  "tanımlayın ya da Ayarlar'dan politikayı değiştirin.";

/** Kiracının AI politikası — kayıt yoksa SERBEST kabul edilir. */
export async function tenantAiPolicy(
  prisma: PrismaService,
  tenantId: string,
): Promise<{ aiPolicy: "SERBEST" | "SADECE_YEREL"; autoMaskConsent: boolean }> {
  const tenant = await prisma.client.tenant.findUnique({
    where: { id: tenantId },
    select: { aiPolicy: true, autoMaskConsent: true },
  });
  return {
    aiPolicy: (tenant?.aiPolicy ?? "SERBEST") as "SERBEST" | "SADECE_YEREL",
    autoMaskConsent: tenant?.autoMaskConsent ?? false,
  };
}

/**
 * Rota kabul edilebilir mi? SADECE_YEREL politikasında dış adres → 422.
 *
 * @throws UnprocessableEntityException politika ihlalinde.
 */
export async function assertAiPolicyAllows(
  prisma: PrismaService,
  tenantId: string,
  config: ProviderRouteInfo,
): Promise<void> {
  const { aiPolicy } = await tenantAiPolicy(prisma, tenantId);
  if (aiPolicy !== "SADECE_YEREL") return;
  if (!isExternalDestination(config.type, config.baseUrl)) return;
  throw new UnprocessableEntityException({
    aiPolicyViolation: true,
    policy: aiPolicy,
    provider: config.name ?? config.type,
    message: LOCAL_ONLY_MESSAGE,
  });
}
