/**
 * NomosOS Müvekkil Portalı — API istemcisi.
 *
 * ÜÇÜNCÜ KİMLİK YÜZEYİ. Büro (apps/web) ve platform (apps/admin) istemcilerinden
 * bilinçli olarak ayrıdır:
 *
 * | | Büro | Platform | **Portal** |
 * |---|---|---|---|
 * | Yol öneki | `/api/v1` | `/api/admin/v1` | `/api/v1/portal` |
 * | Token anahtarı | nomosos_token | nomosos_admin_token | nomosos_portal_token |
 * | JWT audience | tenant | platform | portal |
 *
 * Portal token'ı büro/platform uçlarında, büro/platform token'ı portal uçlarında
 * ASLA geçerli değildir. Bu yaptırım SUNUCUDADIR (`aud` denetimi); istemcinin
 * görevi yalnızca anahtarları ayrı tutmak ve token'ları karıştırmamaktır.
 *
 * TEMSİLİ (MOCK) VERİ YOKTUR. Uç yanıt vermezse ekranda uydurma bilgi değil,
 * nazik bir bilgilendirme çıkar.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Portal uçlarının tam öneki. Yollar bu önek OLMADAN yazılır (bkz. endpoints.ts). */
export const PORTAL_API_PREFIX = "/api/v1/portal";

const TOKEN_KEY = "nomosos_portal_token";
const USER_KEY = "nomosos_portal_user";

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
    /* localStorage kapalı olabilir — oturum yalnız bu sekmede yaşar */
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

export interface StoredPortalUser {
  id?: string;
  fullName?: string;
  email?: string;
  /** Bağlı olunan müvekkil kaydı (tüzel kişide şirket adı). */
  clientId?: string;
  clientName?: string;
  /** Büronun adı — üst çubukta "… Hukuk Bürosu" olarak görünür. */
  tenantName?: string;
}

export function setStoredUser(user: StoredPortalUser): void {
  try {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* yoksay */
  }
}

export function getStoredUser(): StoredPortalUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredPortalUser) : null;
  } catch {
    return null;
  }
}

/**
 * SUNUCU BİÇİMİ → EKRAN BİÇİMİ. Tek dönüşüm noktası.
 *
 * `GET /auth/me` müvekkili `client: { id, name }`, büroyu `officeName` olarak
 * döndürür; giriş yanıtı ise düz `portalUser.clientId` / `clientName` verir.
 * İki biçim de burada tek bir yapıya iner — çağıran taraf alan adı tahmin
 * etmez (denetim bulgusu G: başlıkta müvekkil ve büro adı boş kalıyordu).
 */
export function toStoredUser(source: {
  id?: string;
  email?: string;
  fullName?: string;
  clientId?: string;
  clientName?: string | null;
  client?: { id?: string; name?: string } | null;
  officeName?: string | null;
  tenantName?: string | null;
}): StoredPortalUser {
  return {
    id: source.id,
    email: source.email,
    fullName: source.fullName,
    clientId: source.clientId ?? source.client?.id,
    clientName: source.clientName ?? source.client?.name ?? undefined,
    tenantName: source.officeName ?? source.tenantName ?? undefined,
  };
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
  /** 401'de otomatik çıkış yapma (giriş ve davet ekranları için). */
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

export function buildUrl(path: string, query?: ApiOptions["query"]): string {
  let url = `${API_BASE}${PORTAL_API_PREFIX}${path}`;
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

export async function portalApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
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
    // Ağ hatası / servis kapalı. Müvekkile teknik ayrıntı yerine sakin bir cümle
    // gösterilir; adres yalnızca `title` içinde geçer (ResourceView).
    throw new ApiError("Bağlantı kurulamadı.", 0, null);
  }

  if (res.status === 401 && !options.noAuthRedirect && !path.startsWith("/auth/")) {
    clearToken();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/giris")) {
      window.location.href = "/giris";
    }
    throw new ApiError("Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.", 401, null);
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
      extractMessage(data, "İşlem tamamlanamadı."),
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
 *
 * 0   → ağ hatası / API ayakta değil
 * 404 → rota yok  (DİKKAT: yayınlanmamış kaynak da 404 döner — bkz. aşağıdaki not)
 * 501..504 → uygulanmamış / geçici olarak erişilemiyor
 *
 * NOT: Portal API'si, yayınlanmamış bir kaynağın id'si tahmin edilerek istendiğinde
 * de 404 döndürür (Modül 10, kabul kriteri 2). Bu ikisi istemciden ayırt EDİLEMEZ ve
 * ayırt edilmemelidir — her iki durumda da müvekkile "burada gösterilecek bir şey yok"
 * denir, "böyle bir kayıt var ama size kapalı" DENMEZ. Aksi hâli yayın kontrolünü
 * delen bir bilgi sızıntısı olurdu.
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

export function errorMessage(err: unknown, fallback = "İşlem tamamlanamadı."): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
