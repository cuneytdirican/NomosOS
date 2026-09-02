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
    // İ-55: Middleware'in /app kabuğunu koruyabilmesi için bir PROXY çerezi
    // bırakılır. Bu çerez TOKEN DEĞİLDİR — yalnızca "oturum var" sinyalidir
    // (httpOnly değil; middleware okur). Gerçek yetki denetimi API'dedir.
    document.cookie = "nomosos_session=1; path=/; SameSite=Lax";
  } catch {
    /* localStorage kapalı olabilir */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    // Demo gezinti bayrağı da oturumla birlikte düşer.
    window.localStorage.removeItem(DEMO_ROLE_KEY);
    // İ-55: proxy çerezi de temizlenir.
    document.cookie = "nomosos_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  } catch {
    /* yoksay */
  }
}

/* ------------------------------------------------------------------ *
 * DEMO GEZİNTİ OTURUMU (/demo-giris)
 *
 * Demo giriş sayfası gerçek login akışını KULLANIR (aynı /auth/login
 * ucu, aynı token); yalnızca hangi rolle gezildiğini panel şeridinde
 * göstermek için ayrı bir bayrak bırakır. Bayrak kimlik değildir:
 * yetkiyi YİNE sunucu belirler, localStorage'a bakılmaz.
 * ------------------------------------------------------------------ */

const DEMO_ROLE_KEY = "nomosos_demo_role";

/** Demo girişten gelinen rolü işaretler (yalnızca gösterim amaçlı). */
export function setDemoRole(role: string): void {
  try {
    window.localStorage.setItem(DEMO_ROLE_KEY, role);
  } catch {
    /* yoksay */
  }
}

/** Demo gezintisi aktifse rolü, değilse null döner. */
export function getDemoRole(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DEMO_ROLE_KEY);
  } catch {
    return null;
  }
}

/** Yalnız demo bayrağını temizler (oturumu düşürmez). */
export function clearDemoRole(): void {
  try {
    window.localStorage.removeItem(DEMO_ROLE_KEY);
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
    // İ-47: 403'e özel mesaj — sunucu bazen yalnız "Forbidden" döndürüyordu;
    // avukat neyin yasak olduğunu anlayamıyordu.
    if (res.status === 403) {
      throw new ApiError(
        extractMessage(data, "Bu işlem için yetkiniz yok."),
        403,
        data,
      );
    }
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

// ---------------------------------------------------------------------------
// SAYFALAMA ZARFI  (denetim bulgusu K-15)
// ---------------------------------------------------------------------------
//
// Sunucu liste uçları `paged()` zarfı döndürür:
//   { items, total, page, limit, totalPages }
// ve `MAX_PAGE_SIZE = 200` sabit üst sınırı uygular.
//
// Önceden istemci `limit: "200"` isteyip `asList()` ile YALNIZCA `items`'ı
// alıyordu; `total` ve `totalPages` atılıyordu. 260 açık süresi olan büroda
// 60 süre hiçbir ekranda görünmüyordu ve kırpıldığına dair TEK BİR İŞARET
// bile yoktu. Aşağıdaki yardımcılar zarfı okur, kırpma olasılığını hesaplar
// ve ekranların hem gerçek sayfalama hem de görünür uyarı gösterebilmesini
// sağlar.
//
// `/clients` ucunun sunucu tavanı 200 değil 100'dür (clients.service.ts:71
// `resolvePage`'i kullanmıyor). Bu bir SUNUCU tarafı kusurudur; istemci
// tarafında zarfın döndürdüğü gerçek `limit` okunarak tolere edilir —
// `readPaged` istenen limiti değil SUNUCUNUN uyguladığı limiti esas alır.

/** Sunucunun uyguladığı sabit üst sınır (apps/api/src/common/pagination.ts). */
export const SERVER_MAX_PAGE_SIZE = 200;

/** Liste ekranlarının varsayılan sayfa boyutu (sunucu varsayılanıyla aynı). */
export const DEFAULT_PAGE_SIZE = 20;

export interface PagedResult<T> {
  items: T[];
  /** Sunucudaki TOPLAM kayıt sayısı (zarf yoksa dönen kayıt sayısı). */
  total: number;
  page: number;
  /** Sunucunun FİİLEN uyguladığı sayfa boyutu (istenen değil). */
  limit: number;
  totalPages: number;
  /** Bu sayfadan sonra sunucuda başka kayıt var mı? */
  hasMore: boolean;
  /**
   * Zarf okunamadı (uç düz dizi döndü) VE dönen kayıt sayısı istenen limite
   * dayandı → sessiz kırpma ihtimali var. Ekran görünür uyarı göstermelidir.
   */
  truncated: boolean;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Ham yanıtı sayfalama zarfı olarak okur. Zarf yoksa (düz dizi dönen uçlar)
 * kırpma ihtimalini `truncated` ile bildirir — sessizce yutmaz.
 */
export function readPaged<T>(
  payload: unknown,
  requested: { page?: number; limit?: number } = {},
): PagedResult<T> {
  const items = asList<T>(payload);
  const reqPage = requested.page && requested.page > 0 ? requested.page : 1;
  const reqLimit = requested.limit && requested.limit > 0 ? requested.limit : DEFAULT_PAGE_SIZE;

  const envelope =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;

  if (envelope && typeof envelope.total === "number" && Number.isFinite(envelope.total)) {
    const total = envelope.total;
    // Sunucu tavanı istenen limitten küçük olabilir (/clients → 100).
    const limit = Math.max(1, numberOr(envelope.limit, reqLimit));
    const page = Math.max(1, numberOr(envelope.page, reqPage));
    const totalPages = Math.max(1, numberOr(envelope.totalPages, Math.ceil(total / limit) || 1));
    return {
      items,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
      truncated: false,
    };
  }

  // Zarfsız uç: kaç kayıt olduğunu bilmiyoruz. Limite dayandıysak kırpılmış olabilir.
  const truncated = items.length >= reqLimit;
  return {
    items,
    total: items.length,
    page: 1,
    limit: reqLimit,
    totalPages: 1,
    hasMore: false,
    truncated,
  };
}

export interface PagedOptions {
  query?: ApiOptions["query"];
  page?: number;
  limit?: number;
}

/**
 * Sayfalı liste ucunu çağırır ve zarfı TİPLİ olarak döndürür.
 * `page`/`limit` otomatik olarak sorguya eklenir; `query` içindeki diğer
 * süzgeçler (q, status, caseId …) olduğu gibi geçirilir.
 */
export async function fetchPaged<T>(
  path: string,
  options: PagedOptions = {},
): Promise<PagedResult<T>> {
  const page = options.page && options.page > 0 ? options.page : 1;
  const limit = Math.min(
    SERVER_MAX_PAGE_SIZE,
    options.limit && options.limit > 0 ? options.limit : DEFAULT_PAGE_SIZE,
  );
  const payload = await api<unknown>(path, {
    query: { ...(options.query ?? {}), page: String(page), limit: String(limit) },
  });
  return readPaged<T>(payload, { page, limit });
}
