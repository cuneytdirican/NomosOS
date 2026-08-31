/**
 * NomosOS mobil API istemcisi — TEK GİRİŞ NOKTASI.
 *
 * Hiçbir ekran doğrudan `fetch` çağırmaz. Buradan geçmenin karşılığı:
 *  - Bearer token'ı tek yerde eklemek (token bellekte tutulur, kalıcı kopyası
 *    yalnızca SecureStore'dadır — bkz. src/auth/session.tsx),
 *  - 401'i tek yerde ele almak (oturum kapat → /giris),
 *  - ağ hatalarını KULLANICIYA ANLAŞILIR TÜRKÇE ile yüzeye çıkarmak,
 *  - her isteğe zaman aşımı koymak (adliye kapalı alanında şebeke sürünür;
 *    süresiz bekleyen bir istek "uygulama dondu" olarak algılanır).
 *
 * Kimlik alanı: KİRACI (büro) API'si — `/api/v1`, JWT `aud="tenant"`.
 * Platform (`/api/admin/v1`) ve müvekkil portalı (`/api/v1/portal`) uçlarına
 * bu istemciden ERİŞİLMEZ; üç kimlik alanı karışmaz.
 */

import Constants from "expo-constants";

/** İstek zaman aşımı (ms). Adliye içi zayıf şebeke için bilinçli olarak cömert. */
const REQUEST_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }

  /** Sunucu bu ucu tanımıyor (henüz yayına alınmamış modül). */
  get isNotImplemented(): boolean {
    return this.status === 404;
  }

  /** Ağ/erişim hatası — istek sunucuya hiç ulaşmadı. */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /**
   * Yapılandırma hatası (güvensiz ya da eksik sunucu adresi).
   * `isNetwork`ten AYRIDIR: kullanıcının şebekesi kusursuz olabilir; sorun
   * derlemededir ve "bağlantınızı kontrol edin" demek yanlış yönlendirir.
   */
  get isConfiguration(): boolean {
    return this.status === -1;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * API taban adresi.
 *
 * Öncelik: EXPO_PUBLIC_API_URL → app.json extra.apiUrl → Expo geliştirme
 * sunucusunun IP'si (:3001) → localhost.
 *
 * Üçüncü adım önemlidir: GERÇEK CİHAZDA `localhost` cihazın kendisidir,
 * geliştirme makinesi değil. Expo'nun hostUri'sinden IP'yi türetmek, ekibin
 * her cihaz için elle IP yazmasını gereksiz kılar.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ÜRETİMDE ŞİFRESİZ HTTP YOKTUR (denetim bulgusu 3 — KRİTİK).              ║
 * ║                                                                          ║
 * ║ Eski çözümde şema HİÇ DOĞRULANMIYORDU: `EXPO_PUBLIC_API_URL` `http://`   ║
 * ║ olabiliyor, değişken hiç verilmezse LAN IP'sine ya da `localhost`a       ║
 * ║ sessizce düşülüyordu. İki ayrı arıza doğuruyordu:                        ║
 * ║   · Değişkensiz alınan bir üretim derlemesi hata vermeden paketleniyor,  ║
 * ║     kullanıcıya "Sunucuya ulaşılamadı" olarak görünüyordu.               ║
 * ║   · Adres doğru ama `https` yerine `http` yazıldıysa uygulama ÇALIŞIYOR  ║
 * ║     ve adliye/otel Wi-Fi'ında JWT, müvekkil adı, esas no ve duruşma      ║
 * ║     listesi DÜZ METİN akıyordu. Araya giren biri token'ı alıp `/api/v1`  ║
 * ║     üzerinden bütün büro dosyalarına erişebilirdi.                       ║
 * ║                                                                          ║
 * ║ Kural: `__DEV__` dışında YALNIZ `https:` kabul edilir. Geçersizse adres  ║
 * ║ boş kalır ve her istek anlaşılır bir Türkçe hatayla düşer — sessizce     ║
 * ║ şifresiz bir adrese bağlanmaktansa hiç bağlanmamak doğrudur.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/** Üretim derlemesinde taban adres çözülemediyse dolan gerekçe. */
let baseUrlProblem: string | null = null;

function isSecure(url: string): boolean {
  return url.toLowerCase().startsWith("https://");
}

function resolveBaseUrl(): string {
  const candidate = pickCandidate();

  // Geliştirmede http serbesttir: Expo sunucusu ve yerel API TLS taşımaz.
  if (__DEV__) return candidate.url;

  if (!candidate.url || candidate.source === "varsayilan") {
    baseUrlProblem =
      "Sunucu adresi yapılandırılmamış. Bu derlemede EXPO_PUBLIC_API_URL (ya da " +
      "app.json → extra.apiUrl) tanımlı değil; uygulama hangi sunucuya bağlanacağını bilmiyor. " +
      "Bürodan bilgi teknolojileri sorumlusuna başvurun.";
    return "";
  }
  if (!isSecure(candidate.url)) {
    baseUrlProblem =
      `Sunucu adresi güvenli değil (${candidate.url}). Üretim derlemesinde yalnız https:// ` +
      "adres kabul edilir; şifresiz bağlantıda oturum anahtarı ve müvekkil bilgileri ağ " +
      "üzerinde açık akar. Bağlantı KURULMADI.";
    return "";
  }
  return candidate.url;
}

function pickCandidate(): { url: string; source: "env" | "app.json" | "expo-host" | "varsayilan" } {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return { url: trimTrailingSlash(fromEnv), source: "env" };
  }

  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  if (extra?.apiUrl) return { url: trimTrailingSlash(extra.apiUrl), source: "app.json" };

  const hostUri = Constants.expoConfig?.hostUri;
  if (typeof hostUri === "string" && hostUri.length > 0) {
    const host = hostUri.split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return { url: `http://${host}:3001`, source: "expo-host" };
    }
  }
  return { url: "http://localhost:3001", source: "varsayilan" };
}

export const API_BASE = resolveBaseUrl();

/**
 * Taban adres kullanılamıyorsa gerekçesi; kullanılabiliyorsa `null`.
 * Ayarlar ve giriş ekranları bunu kullanıcıya GÖSTERİR — "sunucuya
 * ulaşılamadı" demek, sorunu şebekeye yıkmak olurdu.
 */
export const API_BASE_PROBLEM: string | null = baseUrlProblem;

// ---------------------------------------------------------------------------
// Oturum kancaları — session.tsx tarafından kurulur (döngüsel bağımlılık olmasın)
// ---------------------------------------------------------------------------

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** 401 geldiğinde çağrılır (oturumu temizle + giriş ekranına dön). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

// ---------------------------------------------------------------------------

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Giriş isteği gibi token gerektirmeyen çağrılar için. */
  skipAuth?: boolean;
  signal?: AbortSignal;
}

function extractMessage(data: unknown, fallback: string): string {
  if (data !== null && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const raw = obj.message ?? obj.error ?? obj.detail;
    if (typeof raw === "string" && raw.length > 0) return raw;
    if (Array.isArray(raw) && raw.length > 0) return raw.map(String).join(" ");
  }
  if (typeof data === "string" && data.length > 0 && data.length < 300) return data;
  return fallback;
}

function buildUrl(path: string, query: ApiOptions["query"]): string {
  let url = `${API_BASE}/api/v1${path}`;
  if (!query) return url;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (parts.length > 0) url += `?${parts.join("&")}`;
  return url;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  // Taban adres güvenli değilse İSTEK HİÇ KURULMAZ. Hata `isNetwork` değildir:
  // sorun şebekede değil yapılandırmadadır ve ekran bunu böyle söylemelidir.
  if (API_BASE_PROBLEM !== null) {
    throw new ApiError(API_BASE_PROBLEM, -1, null);
  }
  const url = buildUrl(path, options.query);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!options.skipAuth && authToken) headers.Authorization = `Bearer ${authToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Çağıranın kendi iptali (ekran kapandı) ile zaman aşımı birlikte çalışsın.
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", externalAbort);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = options.signal?.aborted === true;
    throw new ApiError(
      aborted
        ? "İstek iptal edildi."
        : "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin veya birkaç saniye sonra tekrar deneyin.",
      0,
      error,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
  }

  if (response.status === 401 && !path.startsWith("/auth/")) {
    onUnauthorized?.();
    throw new ApiError("Oturum süresi doldu. Lütfen yeniden giriş yapın.", 401, null);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new ApiError(extractMessage(data, `İstek başarısız oldu (HTTP ${response.status}).`), response.status, data);
  }

  return data as T;
}

/** Liste uçları kimi yerde düz dizi, kimi yerde `{ items: [...] }` döndürür. */
export function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload !== null && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["items", "data", "results", "rows"]) {
      const value = obj[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

/** Herhangi bir hatayı kullanıcıya gösterilebilir Türkçe metne çevirir. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Beklenmeyen bir hata oluştu.";
}
