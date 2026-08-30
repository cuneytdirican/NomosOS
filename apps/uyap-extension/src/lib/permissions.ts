/**
 * Ana bilgisayar izni yönetimi.
 * Varsayılan bulut adresi (app.nomosos.com) manifest'te tanımlıdır; kendi sunucusunu
 * (self-hosted) kullanan bürolar için izin, kullanıcı hareketiyle (popup'taki düğme)
 * `optional_host_permissions` üzerinden istenir.
 */

import { normalizeBaseUrl } from "./settings";

export function originPatternFor(baseUrl: string): string | null {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

export async function hasHostPermission(baseUrl: string): Promise<boolean> {
  const origin = originPatternFor(baseUrl);
  if (!origin) return false;
  return chrome.permissions.contains({ origins: [origin] });
}

/** Kullanıcı hareketi içinde çağrılmalıdır (popup düğmesi). */
export async function requestHostPermission(baseUrl: string): Promise<boolean> {
  const origin = originPatternFor(baseUrl);
  if (!origin) return false;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}
