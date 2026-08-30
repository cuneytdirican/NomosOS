/**
 * NomosOS API istemcisi.
 * - Taban adres: NEXT_PUBLIC_API_URL (varsayılan http://localhost:3001), yollar /api/v1/...
 * - JWT token localStorage("nomosos_token") içinde tutulur.
 * - 401 yanıtında token temizlenir ve /giris sayfasına yönlendirilir.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const TOKEN_KEY = "nomosos_token";
const USER_KEY = "nomosos_user";

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

export interface StoredUser {
  id?: string;
  fullName?: string;
  email?: string;
  role?: string;
}

export function setStoredUser(user: StoredUser): void {
  try {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* yoksay */
  }
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

/** API hatası — durum kodu ve ham gövde ile birlikte fırlatılır (409 PII akışı için gerekli). */
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
}

function extractMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const msg = obj.message ?? obj.error ?? obj.detail;
    if (typeof msg === "string" && msg.length > 0) return msg;
    if (Array.isArray(msg) && msg.length > 0) return msg.map(String).join(", ");
  }
  return fallback;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let url = `${API_BASE}/api/v1${path}`;
  if (options.query) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null && value !== "") {
        qs.set(key, String(value));
      }
    }
    const q = qs.toString();
    if (q) url += `?${q}`;
  }

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
    throw new ApiError(
      "API sunucusuna ulaşılamadı. Servisin çalıştığından emin olun (" + API_BASE + ").",
      0,
      null,
    );
  }

  if (res.status === 401 && !path.startsWith("/auth/")) {
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

/** API bazı uçlarda düz dizi, bazılarında { data: [...] } veya { items: [...] } dönebilir. */
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
