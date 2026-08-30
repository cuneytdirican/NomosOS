import { createHmac } from "node:crypto";

/**
 * PLATFORM (SİSTEM YÖNETİM PANELİ) SABİTLERİ — docs/moduller/25-sistem-yonetim-paneli.md
 *
 * Bu modül NomosOS'u İŞLETEN ŞİRKETİN API'sidir; kiracı (tenant) uygulamasının
 * API'si değildir. İki dünya bilinçli olarak ayrıdır:
 *   - ayrı kimlik tablosu (PlatformUser ↔ User arasında FK yok),
 *   - ayrı JWT audience (`aud: "platform"`),
 *   - ayrı imza anahtarı (aşağıya bakınız),
 *   - ayrı yol öneki (`/api/admin/v1`).
 */

/**
 * Controller yolu öneki.
 *
 * TEK KAYNAK: tüm platform controller'ları `@PlatformController(`${ADMIN_ROUTE_PREFIX}/...`)`
 * yazar. Entegrasyon ajanı `main.ts`'te önek stratejisini değiştirmek isterse
 * DEĞİŞTİRİLECEK TEK YER burasıdır (bkz. platform/README notu ve teslim raporu).
 *
 * Hedef genel adres: `/api/admin/v1/...`
 */
export const ADMIN_ROUTE_PREFIX = "admin/v1";

/** Platform JWT audience — tenant token'ı bu değeri ASLA taşımaz. */
export const PLATFORM_JWT_AUDIENCE = "platform";

/** İki adımlı girişin (2FA) ara token'ı için audience. */
export const PLATFORM_2FA_AUDIENCE = "platform-2fa";

/** Panel oturumu — spec §Güvenlik 3: mutlak oturum 8 saat. */
export const PLATFORM_TOKEN_TTL = "8h";

/** 2FA challenge / kurulum token'ı ömrü. */
export const PLATFORM_CHALLENGE_TTL = "10m";

/** Dört-göz onay talebi zaman aşımı (saat) — spec: 72 saat. */
export const APPROVAL_EXPIRY_HOURS = 72;

/** Destek erişim penceresi varsayılan süresi (saat). */
export const SUPPORT_GRANT_DEFAULT_HOURS = 4;

/** Destek erişim penceresi AZAMİ süresi (saat) — spec: 24 saat, aşılamaz. */
export const SUPPORT_GRANT_MAX_HOURS = 24;

/** Sistemde her an bulunması gereken asgari aktif SUPER_ADMIN sayısı. */
export const MIN_ACTIVE_SUPER_ADMINS = 2;

/** Bakım modu ayarının SystemSetting anahtarı. */
export const MAINTENANCE_SETTING_KEY = "maintenance_mode";

/** Tenant iç notunun tutulduğu yer (Tenant tablosunda `note` alanı yoktur). */
export const TENANT_NOTE_FIELD = "Subscription.note";

/**
 * PLATFORM JWT İMZA ANAHTARI — tenant anahtarından FARKLIDIR.
 *
 * Spec §Güvenlik 1: "panel token … **farklı imza anahtarı**". Böylece tenant
 * guard'ı platform token'ını imza aşamasında reddeder (audience kontrolünden
 * bağımsız, ikinci savunma hattı) ve tersi de geçerlidir.
 *
 * `PLATFORM_JWT_SECRET` tanımlıysa o kullanılır. Tanımlı değilse anahtar,
 * tenant `JWT_SECRET`'inden HMAC-SHA256 ile TÜRETİLİR — aynı değer değildir ve
 * birinden diğeri elde edilemez (tek yönlü). Böylece dağıtım tarafında ek
 * yapılandırma zorunluluğu doğmadan anahtar ayrımı korunur.
 */
export function platformJwtSecret(): string {
  const explicit = process.env.PLATFORM_JWT_SECRET?.trim();
  if (explicit) {
    if (explicit.length < 32) {
      throw new Error(
        "PLATFORM_JWT_SECRET en az 32 karakter olmalıdır. Kısa anahtar kaba kuvvetle " +
          "çözülebilir; platform paneli tüm büroların üstveri ve faturalama kayıtlarına bakar."
      );
    }
    return explicit;
  }
  const base = process.env.JWT_SECRET?.trim();
  if (!base || base.length < 32) {
    throw new Error(
      "Platform paneli için imza anahtarı üretilemedi: PLATFORM_JWT_SECRET tanımlı değil ve " +
        "JWT_SECRET yok/çok kısa. .env dosyanıza en az 32 karakterlik bir değer ekleyin."
    );
  }
  return createHmac("sha256", base).update("nomosos-platform-admin-v1").digest("hex");
}

/**
 * 2FA zorunlu mu?
 *
 * Spec §Güvenlik 2 üretimde İSTİSNASIZ 2FA ister. Geliştirme ortamında panelin
 * hiç açılamaması geliştirmeyi kilitlediği için davranış env ile seçilir:
 *   PLATFORM_REQUIRE_2FA=true  → 2FA kurulmamış kullanıcı YALNIZCA kurulum
 *                                ucuna erişebilir; token alamaz.
 *   (tanımsız / false)         → 2FA kurulmuşsa iki adımlı giriş uygulanır,
 *                                kurulmamışsa tek adımda token verilir.
 * ÜRETİMDE `true` OLMALIDIR (teslim raporunda not düşüldü).
 */
export function requireTwoFactor(): boolean {
  return (process.env.PLATFORM_REQUIRE_2FA ?? "").toLowerCase() === "true";
}
