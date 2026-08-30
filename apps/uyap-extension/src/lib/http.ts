/**
 * Düşük seviye HTTP yardımcıları.
 * Yalnızca NomosOS backend'ine ve ön-imzalı depo adreslerine istek atılır;
 * üçüncü taraf hiçbir servise bağlanılmaz (docs/05 § 7 — KVKK önlemi).
 */

import { ApiError, codeFromStatus, isRetryableCode, messageForCode } from "./errors";

export interface JsonRequestOptions {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly url: string;
  readonly body?: unknown;
  readonly accessToken?: string | null;
  readonly timeoutMs?: number;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /**
   * 204/boş gövde beklenen uçlar için true.
   *
   * DÜZELTİLDİ (kod tutarlılık denetimi, bulgu 11): eskiden 204 yanıtında
   * `undefined as T` dönülüyordu; çağıran gövdenin alanlarını okuduğu için
   * tip sistemi uyarmadan "Cannot read properties of undefined" üretiyordu.
   * Artık boş gövde beklenmiyorsa açık ApiError fırlatılır.
   */
  readonly allowEmptyBody?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface ServerErrorBody {
  readonly message?: string;
  readonly error?: string;
  readonly code?: string;
}

/** JSON istek/yanıt; hata durumunda ApiError fırlatır. */
export async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-NomosOS-Client": "uyap-extension",
    ...(options.extraHeaders ?? {}),
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

  let response: Response;
  try {
    response = await fetch(options.url, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // Eklenti kendi jetonunu Authorization başlığıyla taşır; çerez GÖNDERİLMEZ.
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    const code = aborted ? "TIMEOUT" : "NETWORK";
    throw new ApiError(code, messageForCode(code), null, true);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const code = codeFromStatus(response.status);
    const detail = await readErrorDetail(response);
    throw new ApiError(
      code,
      detail ? `${messageForCode(code)} (${detail})` : messageForCode(code),
      response.status,
      isRetryableCode(code),
    );
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    if (options.allowEmptyBody) return undefined as T;
    throw new ApiError(
      "SERVER",
      "NomosOS beklenen veriyi döndürmedi (boş yanıt). Aktarım tamamlanmadı; yeniden denenecek.",
      response.status,
      true,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("SERVER", "NomosOS yanıtı çözümlenemedi (geçersiz JSON).", response.status, true);
  }
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as ServerErrorBody;
      return parsed.message ?? parsed.error ?? parsed.code ?? null;
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return null;
  }
}

/**
 * Ön-imzalı yükleme adresini doğrular.
 *
 * DÜZELTİLDİ (hukuki/KVKK denetimi, bulgu 10): `presign.uploadUrl` sunucudan geldiği
 * gibi kullanılıyordu; https zorunluluğu ve host beyaz listesi yoktu. Yanlış
 * yapılandırılmış ya da ele geçirilmiş bir yanıt evrak baytlarını BAŞKA bir hosta
 * yönlendirebilirdi. Artık adres (a) https olmalı, (b) API ana bilgisayarı ya da
 * eşleştirmede sunucunun bildirdiği depo ana bilgisayarlarından biri olmalıdır.
 * Aksi halde bayt GÖNDERİLMEZ (fail-closed).
 */
export function assertAllowedUploadUrl(
  uploadUrl: string,
  apiBaseUrl: string,
  storageHosts: readonly string[] = [],
): URL {
  let target: URL;
  let api: URL;
  try {
    target = new URL(uploadUrl);
    api = new URL(apiBaseUrl);
  } catch {
    throw new ApiError("FORBIDDEN", "Sunucunun bildirdiği yükleme adresi geçersiz; evrak gönderilmedi.", null, false);
  }
  const localApi = api.protocol === "http:" && (api.hostname === "localhost" || api.hostname === "127.0.0.1");
  const localTarget =
    target.protocol === "http:" && (target.hostname === "localhost" || target.hostname === "127.0.0.1");
  if (target.protocol !== "https:" && !(localApi && localTarget)) {
    throw new ApiError(
      "FORBIDDEN",
      "Yükleme adresi https değil; evrak şifresiz bir bağlantıya gönderilmedi.",
      null,
      false,
    );
  }
  const allowed = new Set<string>([api.hostname.toLowerCase(), ...storageHosts.map((h) => h.toLowerCase())]);
  if (!allowed.has(target.hostname.toLowerCase())) {
    throw new ApiError(
      "FORBIDDEN",
      `Yükleme adresi (${target.hostname}) büronuzun bildirdiği depo adresleri arasında değil; evrak gönderilmedi. ` +
        "Bu bir yapılandırma hatasıysa NomosOS yöneticinize bildirin.",
      null,
      false,
    );
  }
  return target;
}

/** Ön-imzalı URL'e ikili yükleme (depo doğrudan yazımı). */
export async function uploadBinary(
  url: string,
  method: "PUT" | "POST",
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
  timeoutMs = 120_000,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { ...headers },
      body: new Blob([new Uint8Array(bytes).buffer as ArrayBuffer]),
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) {
      const code = codeFromStatus(response.status);
      throw new ApiError(code, `Evrak yüklenemedi: ${messageForCode(code)}`, response.status, isRetryableCode(code));
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const aborted = error instanceof DOMException && error.name === "AbortError";
    const code = aborted ? "TIMEOUT" : "NETWORK";
    throw new ApiError(code, messageForCode(code), null, true);
  } finally {
    clearTimeout(timeout);
  }
}
