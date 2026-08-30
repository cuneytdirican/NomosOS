/**
 * Sağlayıcı HTTP çağrılarının ortak zaman aşımı kapısı.
 *
 * NEDEN: Node'un `fetch`'inde VARSAYILAN İSTEK ZAMAN AŞIMI YOKTUR. Bir LLM
 * sağlayıcısı bağlantıyı açık tutup yanıt vermezse belge yükleme isteği (hattı
 * senkron koşturan uç) süresiz asılı kalır; ters vekil 504 verse bile sunucu
 * tarafında soket ve bellekteki belge tamponu tutulmaya devam eder. Eşzamanlı
 * birkaç yükleme ile soket/bellek tükenir.
 *
 * Süre `AI_TIMEOUT_MS` ile ayarlanır (varsayılan 60 sn, alt sınır 5 sn).
 */

const DEFAULT_TIMEOUT_MS = 60_000;

export function aiTimeoutMs(): number {
  const raw = typeof process !== "undefined" ? process.env?.AI_TIMEOUT_MS : undefined;
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(5_000, Math.min(600_000, parsed));
}

/**
 * Zaman aşımlı `fetch`. Süre dolduğunda istek İPTAL EDİLİR ve anlaşılır bir
 * Türkçe hata fırlatılır (çağıran katman bunu kullanıcıya sadeleştirerek yansıtır).
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = aiTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new Error(
        `AI sağlayıcısı ${Math.round(timeoutMs / 1000)} saniye içinde yanıt vermedi; istek iptal edildi.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
