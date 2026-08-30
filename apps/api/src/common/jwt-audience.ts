/**
 * JWT AUDIENCE AYRIMI — iki dünyanın sınırı.
 *
 * NomosOS'ta iki ayrı kimlik evreni vardır:
 *   - KİRACI (tenant) uygulaması  → `/api/v1/**`      → `aud: "tenant"`
 *   - PLATFORM yönetim paneli     → `/api/admin/v1/**` → `aud: "platform"`
 *
 * İki taraf zaten AYRI İMZA ANAHTARI kullanır (bkz. `platform.constants.ts →
 * platformJwtSecret()`), yani bir tarafın token'ı diğer tarafta imza aşamasında
 * düşer. Audience bunun ÜSTÜNE konan ikinci kapıdır: ileride anahtarlar
 * yanlışlıkla eşitlenirse (ör. `PLATFORM_JWT_SECRET=JWT_SECRET` yazılırsa) bile
 * bir platform yöneticisinin token'ı kiracı verisine, bir avukatın token'ı da
 * platform paneline ASLA geçemez.
 *
 * NOT: bu değişiklik eski (audience'sız) token'ları geçersiz kılar; kullanıcılar
 * bir kez yeniden giriş yapar. Bilinçli bir tercihtir — audience'sız token'ı
 * "eski sürüm" diye kabul etmek kapıyı yarı açık bırakırdı.
 */

/** Kiracı (büro) uygulamasının token audience'ı. */
export const TENANT_JWT_AUDIENCE = "tenant";
