/**
 * Eşleştirme kodu → extension token akışı.
 *
 * ============================ GÜVENLİK SINIRI ============================
 * Bu eklenti UYAP'a kullanıcının TARAYICIDAKİ MEVCUT OTURUMU ile erişir.
 * UYAP oturum çerezi, e-imza/akıllı kart bilgisi, UYAP parolası veya herhangi bir
 * UYAP kimlik verisi HİÇBİR ZAMAN okunmaz, saklanmaz ve NomosOS'a (ya da başka bir
 * yere) GÖNDERİLMEZ. Eklentinin `permissions` listesinde bilinçli olarak "cookies"
 * izni YOKTUR; çerezlere teknik olarak da erişemez.
 *
 * NomosOS tarafına giden tek kimlik bilgisi, kullanıcının NomosOS web arayüzünde
 * kendi ürettiği kısa ömürlü eşleştirme kodundan alınan, tenant+kullanıcı kapsamlı,
 * iptal edilebilir extension token'dır. Bu token yalnızca `chrome.storage.local`
 * içinde durur (asla `chrome.storage.sync`).
 * =========================================================================
 */

import { ApiError, messageForCode } from "./errors";
import { requestJson } from "./http";
import { STORAGE_KEYS, readLocal, removeLocal, withLock, writeLocal } from "./storage";
import { normalizeBaseUrl } from "./settings";
import type { PairResponse, RefreshRequest, PairRequest } from "../types/dto";
import type { AuthSession } from "../types/state";

/** Erişim jetonu bu eşiğin altına inince yenilenir (ms). */
const REFRESH_MARGIN_MS = 60_000;

/**
 * NomosOS API yolları — UYAP ARKA UCU SÖZLEŞMESİ.
 *
 * Arka uç YAYINDA: `apps/api/src/uyap/uyap.controller.ts` bu uçları sunar
 * (pair, refresh, sync, belge aktarımı, status). Bu sabitler sunucu
 * denetleyicisiyle BİREBİR eşleşir — değişiklik iki tarafta birlikte yapılır.
 *
 * (Yol öneki `api/v1`'dir: `apps/api/src/main.ts` `setGlobalPrefix("api/v1")`
 * kurar; eski `/api/uyap/*` değerleri her çağrıda 404 alırdı.)
 */
export const UYAP_API_PATHS = {
  pair: "/api/v1/uyap/pair",
  refresh: "/api/v1/uyap/pair/refresh",
  syncFiles: "/api/v1/uyap/sync/files",
  syncEvents: "/api/v1/uyap/sync/events",
  presign: "/api/v1/uyap/documents/presign",
  commit: "/api/v1/uyap/documents/commit",
  status: "/api/v1/uyap/status",
} as const;

export function buildUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    throw new ApiError("BAD_REQUEST", "NomosOS sunucu adresi geçersiz.", null, false);
  }
  return `${base}${path}`;
}

export async function getSession(): Promise<AuthSession | null> {
  return readLocal<AuthSession | null>(STORAGE_KEYS.auth, null);
}

export async function isPaired(): Promise<boolean> {
  return (await getSession()) !== null;
}

/**
 * Sunucunun eşleştirmede bildirdiği depo (ön-imzalı yükleme) ana bilgisayarları.
 * Yalnız https ana bilgisayar adı kabul edilir; joker/serbest metin elenir.
 * Boş dönerse yükleme YALNIZ API ana bilgisayarına yapılabilir (fail-closed).
 */
function sanitizeStorageHosts(hosts: readonly string[] | undefined): string[] {
  if (!Array.isArray(hosts)) return [];
  const cleaned = hosts
    .map((host) => String(host).trim().toLowerCase())
    .filter((host) => host.length > 0 && !host.includes("*") && !host.includes("/") && !host.includes(" "));
  return [...new Set(cleaned)].slice(0, 20);
}

function toSession(
  response: PairResponse,
  apiBaseUrl: string,
  pairedAt: number,
  previousStorageHosts: readonly string[] = [],
): AuthSession {
  const expiresAt = Date.parse(response.accessTokenExpiresAt);
  const hosts = sanitizeStorageHosts(response.storageHosts);
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    accessTokenExpiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 15 * 60_000,
    identity: response.identity,
    apiBaseUrl,
    // Yenileme yanıtı listeyi taşımıyorsa eşleştirmede bildirilen liste korunur.
    storageHosts: hosts.length > 0 ? hosts : [...previousStorageHosts],
    pairedAt,
  };
}

/** NomosOS web arayüzünden alınan eşleştirme kodunu extension token'a çevirir. */
export async function pairWithCode(input: {
  readonly pairingCode: string;
  readonly apiBaseUrl: string;
  readonly deviceName: string;
  readonly extensionVersion: string;
}): Promise<AuthSession> {
  const base = normalizeBaseUrl(input.apiBaseUrl);
  if (!base) {
    throw new ApiError("BAD_REQUEST", "NomosOS sunucu adresi geçersiz (https bekleniyor).", null, false);
  }
  const code = input.pairingCode.trim();
  if (code.length < 6) {
    throw new ApiError("BAD_REQUEST", "Eşleştirme kodu eksik veya çok kısa.", null, false);
  }

  const body: PairRequest = {
    pairingCode: code,
    deviceName: input.deviceName,
    extensionVersion: input.extensionVersion,
  };

  const response = await requestJson<PairResponse>({
    method: "POST",
    url: `${base}${UYAP_API_PATHS.pair}`,
    body,
  });

  const session = toSession(response, base, Date.now());
  await writeLocal(STORAGE_KEYS.auth, session);
  return session;
}

/** Oturumu siler (kullanıcı "bağlantıyı kes" dediğinde). */
export async function clearSession(): Promise<void> {
  await removeLocal(STORAGE_KEYS.auth);
}

/**
 * Geçerli erişim jetonunu döndürür; süresi dolmak üzereyse rotasyonlu yenileme yapar.
 * Aynı anda birden çok yenileme isteği gitmesin diye kilit altındadır.
 */
export async function getValidAccessToken(): Promise<{ token: string; session: AuthSession }> {
  return withLock(STORAGE_KEYS.auth, async () => {
    const session = await readLocal<AuthSession | null>(STORAGE_KEYS.auth, null);
    if (!session) {
      throw new ApiError("NOT_PAIRED", messageForCode("NOT_PAIRED"), null, false);
    }
    if (session.accessTokenExpiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return { token: session.accessToken, session };
    }

    const body: RefreshRequest = { refreshToken: session.refreshToken };
    let refreshed: PairResponse;
    try {
      refreshed = await requestJson<PairResponse>({
        method: "POST",
        url: `${session.apiBaseUrl}${UYAP_API_PATHS.refresh}`,
        body,
      });
    } catch (error) {
      // Yenileme jetonu da geçersizse oturumu düşür: kullanıcı yeniden eşleştirmeli.
      if (error instanceof ApiError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) {
        await removeLocal(STORAGE_KEYS.auth);
        throw new ApiError("UNAUTHENTICATED", messageForCode("UNAUTHENTICATED"), error.status, false);
      }
      throw error;
    }

    const next = toSession(refreshed, session.apiBaseUrl, session.pairedAt, session.storageHosts ?? []);
    await writeLocal(STORAGE_KEYS.auth, next);
    return { token: next.accessToken, session: next };
  });
}

/**
 * 401 sonrası tek seferlik zorunlu yenileme.
 * Erişim jetonu sunucu tarafında iptal edilmiş olabilir.
 */
export async function forceRefresh(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  await writeLocal(STORAGE_KEYS.auth, { ...session, accessTokenExpiresAt: 0 });
  try {
    const { token } = await getValidAccessToken();
    return token;
  } catch {
    return null;
  }
}
