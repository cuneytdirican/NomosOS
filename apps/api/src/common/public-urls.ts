/**
 * Dışa dönük adresler — SSO geri dönüşü ve tarayıcı yönlendirmeleri için.
 *
 *  - `WEB_ORIGIN`: CORS beyaz listesiyle aynı değişken; birden çok kaynak
 *    virgülle verilmişse İLKİ büro paneli sayılır (yönlendirme hedefi).
 *  - `API_PUBLIC_URL`: API'nin kimlik sağlayıcıdan görülen adresi
 *    (ör. https://api.buro.com). OIDC `redirect_uri` buradan türetilir.
 * Varsayılanlar geliştirme adresleridir.
 */

export function webOrigin(): string {
  const first = process.env.WEB_ORIGIN?.split(",")[0]?.trim();
  return (first || "http://localhost:3000").replace(/\/+$/, "");
}

export function apiPublicUrl(): string {
  return (process.env.API_PUBLIC_URL?.trim() || "http://localhost:3001").replace(/\/+$/, "");
}
