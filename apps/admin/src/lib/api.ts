/**
 * NomosOS Platform Yönetim Paneli — API istemcisi (GERÇEK uçlar).
 *
 * Tenant uygulamasının istemcisinden (apps/web/src/lib/api.ts) bilinçli olarak AYRIDIR:
 * - Taban adres: NEXT_PUBLIC_ADMIN_API_URL (varsayılan http://localhost:3001)
 * - Yol öneki: /api/admin/v1   (tenant uçları /api/v1/* — token'lar birbirine geçmez)
 * - Token: localStorage("nomosos_admin_token"); JWT payload { sub, role, aud: "platform" }
 * - Platform token'ı /api/v1'de, tenant token'ı /api/admin/v1'de ASLA geçerli değildir
 *   (aud kontrolü sunucudaki PlatformJwtGuard'ın işidir; istemci yalnız ayrı anahtar tutar).
 * - 401 yanıtında token temizlenir ve /giris sayfasına yönlendirilir.
 *
 * TEMSİLİ (MOCK) VERİ YOKTUR. Uç yanıt vermiyorsa ekran "Bu uç henüz hazır değil" der;
 * uydurma sayı gösterilmez.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_ADMIN_API_URL ?? "http://localhost:3001";

export const ADMIN_API_PREFIX = "/api/admin/v1";

const TOKEN_KEY = "nomosos_admin_token";
const USER_KEY = "nomosos_admin_user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* localStorage kapalı olabilir */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    /* yoksay */
  }
}

export interface StoredAdminUser {
  id?: string;
  fullName?: string;
  email?: string;
  /** PlatformUser.role — bkz. src/lib/rbac.ts */
  role?: string;
}

export function setStoredUser(user: StoredAdminUser): void {
  try {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* yoksay */
  }
}

export function getStoredUser(): StoredAdminUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredAdminUser) : null;
  } catch {
    return null;
  }
}

/** API hatası — durum kodu ve ham gövde ile birlikte fırlatılır. */
export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** 401'de otomatik çıkış yapma (giriş ekranı için). */
  noAuthRedirect?: boolean;
}

function extractMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const msg = obj.message ?? obj.error ?? obj.detail;
    if (typeof msg === "string" && msg.length > 0) return msg;
    if (Array.isArray(msg) && msg.length > 0) return msg.map(String).join(", ");
  }
  if (typeof data === "string" && data.length > 0) return data;
  return fallback;
}

export function buildUrl(
  path: string,
  query?: ApiOptions["query"],
): string {
  let url = `${API_BASE}${ADMIN_API_PREFIX}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        qs.set(key, String(value));
      }
    }
    const q = qs.toString();
    if (q) url += `?${q}`;
  }
  return url;
}

export async function adminApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const url = buildUrl(path, options.query);

  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // Ağ hatası / servis kapalı — "uç henüz hazır değil" olarak ele alınır.
    throw new ApiError(
      `Yönetim API'sine ulaşılamadı (${API_BASE}${ADMIN_API_PREFIX}). Servisin çalıştığından emin olun.`,
      0,
      null,
    );
  }

  if (res.status === 401 && !options.noAuthRedirect && !path.startsWith("/auth/login")) {
    clearToken();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/giris")) {
      window.location.href = "/giris";
    }
    throw new ApiError("Oturum süresi doldu. Lütfen yeniden giriş yapın.", 401, null);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(
      extractMessage(data, `İstek başarısız oldu (HTTP ${res.status}).`),
      res.status,
      data,
    );
  }

  return data as T;
}

/** Liste uçları düz dizi ya da { data | items | results | rows } döndürebilir. */
export function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["data", "items", "results", "rows"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

/**
 * Uç "henüz hazır değil" sayılır mı?
 * 0 = ağ hatası / servis kapalı, 404 = rota yok, 501..504 = uygulanmamış veya ayakta değil.
 */
export function isEndpointMissing(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 0 || err.status === 404 || (err.status >= 501 && err.status <= 504);
}

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** Hata mesajını kullanıcıya gösterilecek metne çevirir. */
export function errorMessage(err: unknown, fallback = "İşlem tamamlanamadı."): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
