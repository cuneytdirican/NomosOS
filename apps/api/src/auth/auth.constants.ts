import type { LockoutPolicy } from "../common/account-lockout";

/**
 * KİRACI (BÜRO) HESABI KİMLİK SABİTLERİ — denetim bulgusu K-03.
 *
 * ── İKİ AYRI SAYAÇ ──────────────────────────────────────────────────────────
 * 1. DAR SAYAÇ (`LoginThrottleGuard`, `IP ∧ e-posta`, dakikada 5): tek bir
 *    bağlantıdan gelen hızlı denemeleri keser. Süreç içidir.
 * 2. KALICI HESAP SAYACI (bu politika, veritabanında): DENEMENİN NEREDEN
 *    GELDİĞİNE BAKMAZ. Dağıtık kaba kuvvete karşı tek gerçek savunmadır —
 *    100 farklı çıkış IP'sinden yapılan deneme dar sayacı hiç görmez.
 *
 * EŞİK NEDEN 10: bu sayaç meşru kullanıcıyı da kilitleyebilir. Portal eşiği 20,
 * panel eşiği 5. Büro hesabı ikisinin arasındadır: portal kullanıcısından daha
 * yetkili (daha sıkı olmalı), panel kullanıcısından daha sık giriş yapar
 * (o kadar sıkı olamaz).
 */
export const TENANT_ACCOUNT_MAX_FAILED_ATTEMPTS = 10;

/** Hataların biriktiği pencere. Bunun dışında kalan tek tük hata unutulur. */
export const TENANT_FAILURE_WINDOW_MINUTES = 15;

/** Kilit süresi. */
export const TENANT_LOCKOUT_MINUTES = 15;

export const TENANT_LOCKOUT_POLICY: LockoutPolicy = {
  maxFailedAttempts: TENANT_ACCOUNT_MAX_FAILED_ATTEMPTS,
  failureWindowMinutes: TENANT_FAILURE_WINDOW_MINUTES,
  lockoutMinutes: TENANT_LOCKOUT_MINUTES,
};

/**
 * PAROLA KARMASI MALİYETİ (denetim bulgusu İ-02).
 *
 * Üç kimlik alanının üçünde de 10'du; spec argon2id istiyordu. Argon2'ye geçiş
 * yeni bir bağımlılık ve tüm mevcut karmaların geçişini gerektirir; bcrypt
 * maliyetini 12'ye çıkarmak GERİYE DÖNÜK UYUMLUDUR (bcrypt maliyeti karmanın
 * içinde kodludur; 10 ile üretilmiş eski karmalar doğrulanmaya devam eder ve
 * kullanıcı parolasını değiştirdiğinde kendiliğinden 12'ye yükselir).
 *
 * 12, 10'a göre yaklaşık 4 kat daha pahalıdır (~250 ms); giriş ucunda kabul
 * edilebilir, çevrimdışı kırma denemesinde 4 kat maliyet demektir.
 */
export const PASSWORD_HASH_ROUNDS = 12;

/**
 * PAROLA UZUNLUK TAVANI.
 *
 * bcrypt 72 baytın ötesini yok sayar; ayrıca üst sınırsız bir parola alanı,
 * her denemede pahalı bir karma hesabı tetikleyen ucuz bir DoS yüzeyidir
 * (denetim bulgusu Ö-07 — kiracı şemasında `password` için üst sınır yoktu).
 */
export const PASSWORD_MAX_LENGTH = 200;
