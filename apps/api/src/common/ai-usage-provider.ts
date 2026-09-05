/**
 * AI KULLANIM KAYDI — sağlayıcı referansı.
 *
 * Platform sağlayıcısı (D1.3) yürütücülere `AiProviderConfig` BİÇİMİNDE sentetik
 * bir kayıtla gelir; kimliği `platform:<PlatformAiProvider.id>` öneklidir.
 * `AiUsageLog.providerConfigId` ise `AiProviderConfig` tablosuna yabancı
 * anahtardır — sentetik kimlik oraya yazılınca FK ihlali olur ve TÜM koşu
 * (yanıt üretilmiş olsa da) 500 ile düşer (5 Eylül 2026 canlı bulgusu).
 *
 * Bu yardımcı kimliği doğru sütuna dağıtır: kiracı sağlayıcısı →
 * `providerConfigId`, platform sağlayıcısı → `platformAiProviderId`.
 */

export const PLATFORM_PROVIDER_ID_PREFIX = "platform:";

export function isPlatformProviderId(id: string): boolean {
  return id.startsWith(PLATFORM_PROVIDER_ID_PREFIX);
}

export function usageProviderRef(config: { id: string }): {
  providerConfigId: string | null;
  platformAiProviderId: string | null;
} {
  if (isPlatformProviderId(config.id)) {
    return { providerConfigId: null, platformAiProviderId: config.id.slice(PLATFORM_PROVIDER_ID_PREFIX.length) };
  }
  return { providerConfigId: config.id, platformAiProviderId: null };
}
