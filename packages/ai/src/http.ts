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

import { Agent } from "undici";

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
/**
 * undici zaman aşımları: global fetch başlıklar için 300 sn, gövde parçaları
 * arasında 300 sn bekler (UND_ERR_HEADERS_TIMEOUT / BODY_TIMEOUT). Yavaş yerel
 * modeller (LM Studio, Ollama — uzun prompt işleme) ilk baytı bundan geç
 * verebilir; bu yüzden istek, AI zaman aşımıyla eşlenmiş bir Agent ile atılır.
 * Agent'lar zaman aşımı değerine göre önbelleklenir (bağlantı havuzu paylaşılır).
 */
const agents = new Map<number, Agent>();
function agentFor(timeoutMs: number): Agent {
  let agent = agents.get(timeoutMs);
  if (!agent) {
    agent = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs, connectTimeout: 30_000 });
    agents.set(timeoutMs, agent);
  }
  return agent;
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = aiTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // `dispatcher` Node'un yerleşik fetch'i tarafından tanınır (undici sözleşmesi).
    return await fetch(input, { ...init, signal: controller.signal, dispatcher: agentFor(timeoutMs) } as RequestInit);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new Error(
        `AI sağlayıcısı ${Math.round(timeoutMs / 1000)} saniye içinde yanıt vermedi; istek iptal edildi.`,
      );
    }
    // undici "fetch failed" asıl nedeni (ECONNREFUSED / ECONNRESET / ENOTFOUND…)
    // `cause` içinde saklar; günlükte ve kullanıcı bildiriminde görünür olsun.
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    if (cause && (cause.code || cause.message)) {
      throw new Error(`${(err as Error).message} (${[cause.code, cause.message].filter(Boolean).join(": ")})`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
