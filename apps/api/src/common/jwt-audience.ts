/**
 * JWT AUDIENCE AYRIMI — üç kimlik evreninin sınırı.
 *
 * NomosOS'ta ÜÇ ayrı kimlik evreni vardır (denetim bulgusu İ-29 — buradaki
 * "iki" yazımı portal evrenini görünmez kılıyordu):
 *   - KİRACI (tenant) uygulaması  → `/api/v1/**`           → `aud: "tenant"`
 *   - PLATFORM yönetim paneli     → `/api/admin/v1/**`      → `aud: "platform"`
 *   - MÜVEKKİL PORTALI            → `/api/v1/portal/**`     → `aud: "portal"`
 *
 * Üç taraf zaten AYRI İMZA ANAHTARI kullanır (bkz. `platform.constants.ts →
 * platformJwtSecret()`, `portal.constants.ts → portalJwtSecret()`), yani bir
 * tarafın token'ı diğer tarafta imza aşamasında düşer. Audience bunun ÜSTÜNE
 * konan ikinci kapıdır: ileride anahtarlar yanlışlıkla eşitlenirse (ör.
 * `PLATFORM_JWT_SECRET=JWT_SECRET` yazılırsa) bile bir platform yöneticisinin
 * token'ı kiracı verisine, bir avukatın token'ı platform paneline, bir
 * müvekkilin token'ı büro paneline ASLA geçemez.
 *
 * NOT: bu değişiklik eski (audience'sız) token'ları geçersiz kılar; kullanıcılar
 * bir kez yeniden giriş yapar. Bilinçli bir tercihtir — audience'sız token'ı
 * "eski sürüm" diye kabul etmek kapıyı yarı açık bırakırdı.
 */

/** Kiracı (büro) uygulamasının token audience'ı. */
export const TENANT_JWT_AUDIENCE = "tenant";
