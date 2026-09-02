/**
 * İ-46 — OTURUM ÇEREZİ SABİTLERİ (güvenlik borcu kapatılıyor).
 *
 * DENETİM BULGUSU: JWT `localStorage("nomosos_token")` içinde tutuluyordu.
 * Herhangi bir XSS, `localStorage.getItem("nomosos_token")` ile 12 saatlik
 * geçerli bir belirteci çalıp süresiz kullanabilirdi.
 *
 * ÇÖZÜM: tarayıcı oturumu artık httpOnly çerezle taşınır — JavaScript
 * (dolayısıyla XSS) çerezi OKUYAMAZ, yalnızca tarayıcı istekle birlikte
 * gönderir. Mobil uygulama gövdeden gelen `accessToken` ile `Authorization`
 * başlığını kullanmaya DEVAM EDER (çerez tarayıcı kavramıdır).
 *
 * CSRF NOTU: `SameSite=Lax` tarayıcılar arası POST/PUT/PATCH fetch'lerinde
 * çerezin GÖNDERİLMESİNİ engeller (yalnız üst düzey gezinmelerde gider);
 * CORS beyaz listesi zaten kapalıdır. Kalıntı risk (Lax + GET gezinmesi)
 * değiştiren uçların tamamı PATCH/POST olduğundan GET üzerinden veri
 * değişikliği yapılamaz.
 */

/** Çerez adı — istemcideki eski localStorage anahtarıyla aynı ad, bilinçli. */
export const AUTH_COOKIE_NAME = "nomosos_token";

/** Çerez yalnız API yollarına gönderilir. */
export const AUTH_COOKIE_PATH = "/api/v1";

/** JWT ömrüyle eş (12 saat) — ms. */
export const AUTH_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Çerezi uçtan uca yazma parametreleri.
 *
 * `secure` yalnız üretimde (API_COOKIE_SECURE=true): test/geliştirme
 * ortamı HTTP üzerinde çalışır, `Secure` işaretli çerez tarayıcıca
 * reddedilirdi.
 */
export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: AUTH_COOKIE_PATH,
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    secure: process.env.API_COOKIE_SECURE === "true",
  };
}
