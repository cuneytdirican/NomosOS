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
 * Controller yolu öneki — TAM YOL (global önek uygulanmaz).
 *
 * TEK KAYNAK: tüm platform controller'ları `@PlatformController(`${ADMIN_ROUTE_PREFIX}/...`)`
 * yazar; yayınlanan adres `/api/admin/v1/...` olur.
 *
 * NASIL ÇALIŞIR: `main.ts` global öneki `api/v1` olarak kurar ANCAK bu öneki
 * `api/admin/v1/(.*)` desenine uyan yollardan HARİÇ tutar
 * (`setGlobalPrefix(..., { exclude })`). Bu yüzden buradaki değer, önekin
 * eklenmediği TAM yoldur — kiracı controller'larına hiç dokunulmaz ve URL
 * yeniden yazan (rewrite) bir ara katman gerekmez.
 *
 * DEĞİŞTİRİRSENİZ: `main.ts` içindeki `ADMIN_PREFIX_EXCLUDE_PATTERN` de
 * güncellenmelidir; ikisi birbirine bağlıdır ve `main.ts` açılışta tutarlılığı
 * doğrular (uyuşmazsa uygulama AÇILMAZ).
 */
export const ADMIN_ROUTE_PREFIX = "api/admin/v1";

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

/**
 * HESAP KİLİDİ — spec §Güvenlik 3: "5 başarısız denemede hesap kilitlenir".
 *
 * Hız sınırlayıcı IP başınadır ve `/auth/2fa/verify` gövdesinde e-posta
 * bulunmadığı için tek başına yetmez: farklı IP'lerden yapılan denemeler ayrı
 * kovalara düşer. Bu yüzden sayaç HESAP DÜZEYİNDE tutulur.
 */
export const PLATFORM_MAX_FAILED_ATTEMPTS = 5;

/** Kilit süresi (dakika). Erken açma yetkisi başka bir SUPER_ADMIN'dedir. */
export const PLATFORM_LOCKOUT_MINUTES = 30;

/**
 * Tek bir 2FA challenge token'ı ile yapılabilecek AZAMİ kod denemesi.
 * Aşılınca token iptal edilir; kullanıcı baştan giriş yapar.
 */
export const PLATFORM_MAX_CHALLENGE_ATTEMPTS = 3;

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

/**
 * Panel 2FA zorunluluğu artık ÇALIŞMA ANINDA panelden yönetilir: bu anahtardaki
 * `SystemSetting` (boolean) değeri env'i geçersiz kılar. Kayıt yoksa env'e
 * (`PLATFORM_REQUIRE_2FA`) düşülür. Admin > Sistem > İki Aşamalı Doğrulama.
 */
export const PLATFORM_2FA_SETTING_KEY = "platform.require_two_factor";

/**
 * ÜRETİMDE 2FA'SIZ PANEL AÇILMAZ.
 *
 * Yorumda "üretimde true olmalı" yazmak bir yaptırım değildir; unutulduğunda
 * panel sessizce tek faktörle açılır ve bunu kimse fark etmez. `JWT_SECRET`
 * kontrolüyle aynı desen: eksikse uygulama HİÇ AÇILMAZ.
 */
export function assertTwoFactorPolicy(): void {
  // 2FA zorunluluğu artık panelden (SystemSetting `platform.require_two_factor`)
  // yönetildiği için açılışta SERT KAPATMA YAPILMAZ; env yalnızca kayıt yokken
  // varsayılan olur. Üretimde env kapalıysa yalnızca uyarı düşülür.
  if (process.env.NODE_ENV === "production" && !requireTwoFactor()) {
    console.warn(
      "[2FA] Açılış: PLATFORM_REQUIRE_2FA env kapalı. Panel 2FA zorunluluğu " +
        "SystemSetting 'platform.require_two_factor' değerinden okunur (Admin > Sistem)."
    );
  }
}

/**
 * PANEL 2FA GİZLİ ANAHTARI İÇİN AYRI ŞİFRELEME ANAHTARI.
 *
 * Spec §Güvenlik 7: `MASTER_ENCRYPTION_KEY` panel servisinin ortamında
 * BULUNMAZ. Panel bu fazda kiracı API'siyle aynı süreçte çalıştığı için tam
 * yalıtım (ayrı process/ayrı env) sağlanamıyor; sağlanabilecek olan, panelin
 * KİRACILARIN LLM ANAHTARLARINI ÇÖZEN anahtarı kendi yolunda kullanmamasıdır.
 *
 * `PLATFORM_2FA_ENCRYPTION_KEY` tanımlıysa o kullanılır. Değilse anahtar
 * master anahtardan HMAC-SHA256 ile TÜRETİLİR: türetilmiş anahtarla şifrelenen
 * TOTP kayıtları master anahtarla ÇÖZÜLEMEZ (tek yönlü), yani panel süreci
 * ele geçirilse bile `AiProviderConfig.encryptedApiKey` değerleri bu yoldan
 * açılmaz. Tam süreç ayrımı `apps/admin-api` göçüne bırakılmıştır.
 */
export function platform2faEncryptionKey(): string {
  const explicit = process.env.PLATFORM_2FA_ENCRYPTION_KEY?.trim();
  if (explicit) {
    if (!/^[0-9a-fA-F]{64}$/.test(explicit)) {
      throw new Error(
        "PLATFORM_2FA_ENCRYPTION_KEY 64 haneli hex (32 bayt) olmalıdır. " +
          'Üretmek için: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
    return explicit.toLowerCase();
  }
  const base = process.env.MASTER_ENCRYPTION_KEY?.trim();
  if (!base) {
    throw new Error(
      "Panel 2FA anahtarı üretilemedi: PLATFORM_2FA_ENCRYPTION_KEY tanımlı değil ve " +
        "MASTER_ENCRYPTION_KEY yok."
    );
  }
  return createHmac("sha256", base).update("nomosos-platform-2fa-v1").digest("hex");
}
