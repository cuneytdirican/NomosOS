import { decryptSecret, isEncryptedSecret } from "@nomosos/ai";

/**
 * AI SAĞLAYICI ÖZEL BAŞLIKLARININ TEK OKUMA NOKTASI (denetim bulgusu K-08).
 *
 * `AiProviderConfig.headersJson` eskiden DÜZ METİN saklanıyordu; Azure OpenAI'ın
 * `api-key`, LiteLLM/OpenRouter'ın `Authorization` başlığı burada durur ve
 * gerçek bir API anahtarıdır. Artık `encryptedApiKey` ile aynı korumayı alır
 * (AES-256-GCM, `MASTER_ENCRYPTION_KEY`).
 *
 * Dört ayrı çağıran (`ai`, `assistant`, `caselaw`, `pipeline`) aynı satırı
 * kopyalamıştı; kopyalardan biri güncellenmeseydi o yol çalışmayı bırakırdı.
 * Bu yüzden okuma tek yerdedir.
 *
 * GEÇİŞ: şifrelemeden ÖNCE yazılmış satırlar düz metindir. `isEncryptedSecret`
 * ile ayırt edilir ve düz metin biçimi hâlâ okunur — aksi hâlde şifrelemeye
 * geçiş, mevcut kiracıların çalışan sağlayıcılarını sessizce bozardı.
 */
export function readProviderHeaders(
  stored: string | null | undefined,
): Record<string, string> | undefined {
  if (!stored) return undefined;
  const raw = isEncryptedSecret(stored) ? tryDecrypt(stored) : stored;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, string>;
  } catch {
    return undefined;
  }
}

function tryDecrypt(stored: string): string | undefined {
  try {
    return decryptSecret(stored);
  } catch {
    // Anahtar döndürülmüş ya da kayıt bozulmuş olabilir. FAIL-CLOSED: başlık
    // gönderilmez (yanlış başlıkla çağrı yapmaktansa sağlayıcı 401 versin).
    return undefined;
  }
}
