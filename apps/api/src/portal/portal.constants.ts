import { createHmac } from "node:crypto";

/**
 * MÜVEKKİL PORTALI SABİTLERİ — docs/moduller/10-muvekkil-portali.md
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ÜÇÜNCÜ KİMLİK EVRENİ                                                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * NomosOS'ta artık ÜÇ ayrı kimlik dünyası vardır ve üçü de birbirinin
 * token'ını reddeder:
 *
 *   | Dünya    | Tablo        | Yol öneki        | aud        | İmza anahtarı |
 *   |----------|--------------|------------------|------------|---------------|
 *   | Büro     | User         | /api/v1/**       | "tenant"   | JWT_SECRET    |
 *   | Platform | PlatformUser | /api/admin/v1/** | "platform" | türetilmiş    |
 *   | Portal   | PortalUser   | /api/v1/portal/**| "portal"   | türetilmiş    |
 *
 * Portal, üçünün EN DAR yetkili yüzeyidir: bir müvekkil yalnızca kendi
 * `clientId`'sine bağlı VE avukatın açıkça yayınladığı kaydı görür. Bir hata
 * burada "müvekkil verisi başka müvekkile sızdı" demektir; bu yüzden portal
 * yolunda üç bağımsız kapı üst üste kapalıdır:
 *
 *   1. Ayrı imza anahtarı — büro/platform token'ı imza aşamasında düşer.
 *   2. Ayrı audience    — `aud !== "portal"` ise reddedilir.
 *   3. Ayrı tablo       — `sub` PortalUser'da aranır; User/PlatformUser
 *                         kimliğinin burada karşılığı yoktur.
 *
 * Dördüncü kapı guard'da değil SORGUDA durur: `PortalPublicationService`
 * (allow-list). Kimliği doğrulanmış bir müvekkil bile yayınlanmamış kaydı
 * göremez.
 */

/** Portal token audience — büro (`tenant`) ve panel (`platform`) token'ı bu değeri ASLA taşımaz. */
export const PORTAL_JWT_AUDIENCE = "portal";

/** Portal oturumu — görev tanımı: 8 saat. */
export const PORTAL_TOKEN_TTL = "8h";

/** Portal davet bağlantısının geçerlilik süresi (saat). */
export const PORTAL_INVITE_TTL_HOURS = 72;

/** Parola sıfırlama bağlantısının geçerlilik süresi (dakika). */
export const PORTAL_RESET_TTL_MINUTES = 60;

/** Belge indirme ön-imzalı URL ömrü (saniye) — kısa tutulur, paylaşılabilirliği azaltır. */
export const PORTAL_DOWNLOAD_TTL_SECONDS = 120;

/** Portal parolası asgari uzunluğu. */
export const PORTAL_MIN_PASSWORD_LENGTH = 10;

/** bcrypt maliyet katsayısı — büro tarafıyla AYNI (12; denetim bulgusu İ-02). */
export const PORTAL_BCRYPT_ROUNDS = 12;

/**
 * GİRİŞ KİLİDİ — İKİ AYRI SAYAÇ, İKİ AYRI EŞİK (spec §İş Kuralları 9).
 *
 * ═══ NEDEN İKİ SAYAÇ ═══
 *
 * Tek bir "e-posta başına 5 hata" sayacı, denetimde hedefli bir HİZMET DIŞI
 * BIRAKMA yüzeyi olarak işaretlendi: bir müvekkilin e-postasını bilen herkes,
 * beş hatalı denemeyle o hesabı 15 dakika kilitleyebilir ve döngüde tutarak
 * süresiz kilitleyebilirdi. Üstelik anahtar kiracı içermediği için aynı
 * e-postanın BAŞKA bürolardaki hesapları da birlikte kilitleniyordu.
 *
 * Çözüm, sayacı ikiye ayırmaktır:
 *
 *   1. `PORTAL_MAX_FAILED_ATTEMPTS` — anahtar **IP ∧ e-posta**. Dar ve sıkı.
 *      Saldırgan kendi IP'sini kilitler; kurban etkilenmez.
 *
 *      ⚠ BU DÜZELTME `TRUSTED_PROXY_HOPS`UN DOĞRU KURULMASINA BAĞLIDIR (Ö-08).
 *      Anahtarın dar yarısı GERÇEK istemci IP'sidir; ters vekil arkasında hop
 *      sayısı yanlışsa `req.ip` ya vekilin sabit adresini (tüm müvekkiller tek
 *      kovada — kilit yine herkesi vurur) ya da istemcinin uydurabileceği bir
 *      `X-Forwarded-For` değerini (kova sonsuz, sayaç anlamsız) verir. Bu
 *      yüzden `TRUSTED_PROXY_HOPS` üretimde ZORUNLU alandır: tanımsız veya
 *      geçersizse API hiç açılmaz (`common/trusted-proxy.ts`). Vekil yoksa
 *      doğru cevap "ayarı boş bırakmak" değil, açıkça `0` yazmaktır.
 *   2. `PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS` — anahtar **hesabın kendisi**
 *      (PortalUser satırı; dolayısıyla KİRACIYA ÖZGÜ). Dağıtık denemeye karşı
 *      son duvardır, bu yüzden eşiği belirgin biçimde yüksektir: hedefli
 *      kilitleme pahalı, kaba kuvvet yine imkânsız olsun.
 */
export const PORTAL_MAX_FAILED_ATTEMPTS = 5;

/**
 * Hesabın KENDİSİ için eşik (tüm IP'lerin toplamı). Yüksek tutulur: buradaki
 * kilit, meşru kullanıcıyı da etkileyen tek kilittir.
 */
export const PORTAL_ACCOUNT_MAX_FAILED_ATTEMPTS = 20;

/** Kilit süresi (dakika) — spec: 15 dakika. */
export const PORTAL_LOCKOUT_MINUTES = 15;

/** Hesap sayacı penceresi (dakika): bu süre içinde birikmeyen hatalar unutulur. */
export const PORTAL_FAILURE_WINDOW_MINUTES = 30;

/**
 * PortalInvite tablosunun `createdBy` alanına yazılan SENTİNEL değer.
 *
 * NEDEN: parola sıfırlama için ayrı bir tablo YOKTUR (Faz 5 şeması kapalıdır ve
 * `packages/db` bu ajanın alanı değildir). `PortalInvite` tam olarak gereken
 * alanları taşır (tenantId · clientId · email · tokenHash · expiresAt · usedAt),
 * bu yüzden iki akış aynı tabloyu paylaşır.
 *
 * AYRIM ZORUNLUDUR: davet token'ı HESAP AÇAR, sıfırlama token'ı MEVCUT hesabın
 * parolasını değiştirir. İkisi karışırsa bir sıfırlama bağlantısı yeni hesap
 * açabilir ya da bir davet bağlantısı başkasının parolasını değiştirebilirdi.
 * Bu yüzden `accept-invite` yalnızca `createdBy !== SENTİNEL` satırları,
 * `reset-password` yalnızca `createdBy === SENTİNEL` satırları kabul eder.
 */
export const PORTAL_RESET_CREATED_BY = "PORTAL_PAROLA_SIFIRLAMA";

/**
 * GELİŞTİRME KOLAYLIĞI — parola sıfırlama token'ının yanıtta dönmesi.
 *
 * Portal için e-posta gönderim altyapısı YOKTUR (spec'te sağlayıcı seçimi
 * yapılmadı). Üretimde token'ı yanıtta döndürmek, e-posta adresini bilen
 * herkesin hesabı ele geçirmesi demektir — bu yüzden davranış AÇIK BİR ORTAM
 * DEĞİŞKENİNE bağlanmıştır ve üretimde hiçbir koşulda açılmaz.
 *
 * Davet token'ı bundan FARKLIDIR: onu avukat kendi kimliğiyle üretir ve
 * müvekkiline kendi kanalından iletir; yanıtta bir kez dönmesi tasarımdır.
 *
 * KAPI TERSİNE ÇEVRİLDİ (denetim bulgusu 12): eskiden koşul
 * `NODE_ENV !== "production"` idi. Konteyner dağıtımlarında `NODE_ENV`'in
 * TANIMSIZ kalması yaygındır ve tanımsız bir değer "üretim değil" sayılıyordu.
 * Artık kapı yalnızca `NODE_ENV === "development"` iken açılır: TANIMSIZ = KAPALI.
 */
export function portalEchoResetToken(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return (process.env.PORTAL_DEV_ECHO_RESET_TOKEN ?? "").toLowerCase() === "true";
}

/**
 * PORTAL JWT İMZA ANAHTARI — büro ve platform anahtarlarından FARKLIDIR.
 *
 * `PORTAL_JWT_SECRET` tanımlıysa o kullanılır. Değilse anahtar büro
 * `JWT_SECRET`'inden HMAC-SHA256 ile TÜRETİLİR: aynı değer değildir, tek
 * yönlüdür ve birinden diğeri elde edilemez. Böylece dağıtımda ek yapılandırma
 * zorunluluğu doğmadan üç dünyanın anahtar ayrımı korunur (platform tarafında
 * uygulanan desenin aynısı — `platform.constants.ts → platformJwtSecret`).
 *
 * TÜRETME ETİKETİ platformunkinden farklıdır ("...-portal-v1"); iki türetilmiş
 * anahtar birbirine EŞİT DEĞİLDİR, yani panel token'ı portal ucunda da düşer.
 */
export function portalJwtSecret(): string {
  const explicit = process.env.PORTAL_JWT_SECRET?.trim();
  if (explicit) {
    if (explicit.length < 32) {
      throw new Error(
        "PORTAL_JWT_SECRET en az 32 karakter olmalıdır. Kısa anahtar kaba kuvvetle " +
          "çözülebilir; portal token'ı doğrudan müvekkil verisine bakar."
      );
    }
    return explicit;
  }
  const base = process.env.JWT_SECRET?.trim();
  if (!base || base.length < 32) {
    throw new Error(
      "Müvekkil portalı için imza anahtarı üretilemedi: PORTAL_JWT_SECRET tanımlı değil ve " +
        "JWT_SECRET yok/çok kısa. .env dosyanıza en az 32 karakterlik bir değer ekleyin."
    );
  }
  return createHmac("sha256", base).update("nomosos-client-portal-v1").digest("hex");
}
