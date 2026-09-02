/**
 * PLATFORM YETKİ MATRİSİ — SUNUCU TARAFI YAPTIRIMI.
 *
 * `apps/admin/src/lib/rbac.ts` dosyasının BİREBİR sunucu ikizi. İstemcideki
 * matris yalnızca ergonomidir (düğme gizleme); ASIL yaptırım burasıdır.
 * İki dosya AYNI değerleri taşımak zorundadır — biri değişirse diğeri de
 * değişmelidir (spec §API Uçları: "yetki matrisi tek kaynaktan tanımlanır,
 * UI ve API aynı tanımı kullanır").
 *
 * İLKELER
 * 1. Varsayılan read-only: matriste açıkça verilmeyen her işlem "none"dır.
 * 2. Hiyerarşi düz değildir, ALAN AYRIMIDIR (segregation of duties):
 *    operasyonu yöneten iade yapamaz, parayı yöneten tenant silemez.
 * 3. ANALYST_READONLY hiçbir koşulda mutasyon yapamaz; tenant kimliği,
 *    müvekkil/dosya verisi, tekil ödeme detayı ve denetim izi bu role KAPALIDIR.
 */

import type { PlatformRole } from "@nomosos/db";

export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "OPS_ADMIN",
  "BILLING_ADMIN",
  "SUPPORT_AGENT",
  "ANALYST_READONLY",
] as const;

export type AdminRole = PlatformRole;

/**
 * full      ✅ tam yetki
 * read      👁 salt-okur
 * masked    🔒 maskeli / yalnız toplulaştırılmış salt-okur
 * four_eyes 4️⃣ yapılabilir ama dört-göz onayı (talep eden ≠ onaylayan) gerekir
 * none      ❌ yok
 */
export type PermissionLevel = "full" | "read" | "masked" | "four_eyes" | "none";

export type AdminAction =
  | "tenant.view"
  /**
   * Büro PERSONEL listesi — `tenant.view`'dan ayrıdır.
   *
   * Eskiden bu uç `tenant.view` taşıyordu ve o aksiyon BILLING_ADMIN için de
   * "full"du: faturalama rolü, işine hiç yaramayan personel listesini (ad,
   * soyad, rol, aktiflik, son giriş) her büro için görebiliyordu. PII ihlali
   * değildi ama ALAN AYRIMI (segregation of duties) ilkesiyle çelişiyordu
   * (denetim bulgusu 18).
   */
  | "tenant.users.view"
  | "tenant.create"
  | "tenant.suspend"
  | "tenant.reactivate"
  | "tenant.delete"
  | "tenant.plan_change"
  | "tenant.custom_price"
  | "payment.refund"
  | "payment.view"
  | "system.settings"
  | "system.maintenance_lock"
  | "system.flag_write"
  | "system.flag_global_write"
  | "announcement.publish"
  | "system.health"
  | "system.health.uptime"
  | "ai.analytics.platform"
  | "ai.analytics.tenant"
  | "support.tenant_content"
  | "ai.provider_config"
  | "platform_user.manage"
  /**
   * PANEL PERSONELİ AÇMA — `platform_user.manage`'DEN AYRI AKSİYON.
   *
   * denetim bulgusu K-11: `FOUR_EYES_ACTIONS` listesi `platform_user.manage`'i
   * içeriyordu ama matriste o satır "full"du. İki kaynak ayrışınca admin paneli
   * dört-göz rozetini gösteriyor, API tek imzayla uyguluyordu. Çözüm listeyi
   * matristen TÜRETMEK; bunun için "gerçekten dört-göz olan" alt işlemin kendi
   * satırı olmalıdır. `platform_user.manage` (ad düzeltme, kilit açma, SUPER
   * ADMIN olmayan hesabı pasifleştirme) DOĞRUDAN kalır; hesap AÇMAK ise
   * dört-gözdür (bkz. approval-actions.ts PLATFORM_USER_CREATE).
   */
  | "platform_user.create"
  /**
   * BAŞKASININ PAROLASINI / 2FA KAYDINI SIFIRLAMA — dört-göz.
   * Aynı ayrıştırmanın ikinci yarısı (denetim bulgusu K-11).
   */
  | "platform_user.credential_reset"
  | "platform_user.assign_super_admin"
  /** Demo talepleri (tanıtım sitesi) — panelden izleme ve durum yönetimi. */
  | "demoRequests.view"
  | "demoRequests.update"
  | "audit.view"
  | "audit.export"
  | "board_report.view"
  | "metrics.overview.view"
  | "platform_user.view"
  | "subscription.view"
  | "subscription.transition"
  /**
   * ABONELİK İPTALİ — `subscription.transition`'DAN AYRI AKSİYON (K-11).
   *
   * İptal terminaldir ve HER ZAMAN onaya düşer; durum geçişi ise karışıktır
   * (yıkıcı hedefler onaya, diğerleri doğrudan). Karışık bir ucu dört-göz
   * ilan etmek yanlış vaat, iptali "full" bırakmak eksik vaat olurdu.
   */
  | "subscription.cancel"
  | "plan.catalog.view"
  | "plan.catalog.write"
  /**
   * PLAN OLUŞTURMA VE FİYAT DEĞİŞİKLİĞİ — dört-göz (denetim bulgusu K-11).
   *
   * `plan.catalog.write` (ad, azami kullanıcı, özellik listesi, satışa açıklık)
   * DOĞRUDAN kalır; fiyat koymak/değiştirmek ve fiyatlı yeni bir plan yaratmak
   * TÜM kiracıları etkilediği için ikinci imza ister.
   */
  | "plan.catalog.price"
  | "invoice.view"
  | "invoice.issue"
  | "support_grant.view"
  | "support_grant.request"
  | "support_grant.revoke"
  | "tenant.usage.view"
  | "tenant.notes"
 | "tenant.update"
  | "announcement.view"
  | "approval.view"
  | "approval.decide"
  // --- Modül 26: AI kota ve kredi sistemi ---
  /** Tenant başına kredi kotası ve tüketimi. */
  | "credits.tenant.view"
  /** Manuel kredi tahsisi/düzeltme — HER ROLDE dört-göz (iş kuralı 9). */
  | "credits.tenant.adjust"
  /** Kredi fiyat listesi ve model fiyat tablosu — okuma. */
  | "credits.pricing.view"
  /** Kredi fiyat listesi ve model fiyat tablosu — yazma (SUPER_ADMIN). */
  | "credits.pricing.write"
  /** Maliyet / gelir / marj raporu — ANALYST_READONLY takma adlı görür. */
  | "credits.margin.view"
  /** Yargı organları + noterler referans kataloğu — okuma (panel listesi). */
  | "judicial.view"
  /** Katalog yönetimi: ekleme/düzeltme, senkron ayarı ve tetikleme. */
  | "judicial.manage"
  /** Platform AI sağlayıcıları — okuma (panel listesi). */
  | "aiProvider.view"
  /** Platform AI sağlayıcı yönetimi: ekleme/düzeltme/silme, test, model listesi. */
  | "aiProvider.manage";

type Matrix = Record<AdminAction, Record<AdminRole, PermissionLevel>>;

const N: PermissionLevel = "none";

export const PERMISSION_MATRIX: Matrix = {
  "tenant.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: "masked",
  },
  "tenant.users.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    // Faturalama rolünün büro personel listesine ihtiyacı yoktur.
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: N,
  },
  "tenant.create": {
    // D5 / M2 — kiracı açma uç üzerinden dört-göz talep üretir; matris de
    // dört-gözdür (katalog değişmezi: onay kataloğundaki her eylem dört-gözdür).
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: "four_eyes",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "tenant.suspend": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "four_eyes",
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "tenant.reactivate": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "four_eyes",
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "tenant.delete": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  /**
   * denetim bulgusu K-11 (aynı sınıf): `PATCH /subscriptions/:id` HER ZAMAN
   * onay talebi üretiyordu ama matris "full" diyordu — bu sefer ters yönde
   * yanlış vaat: panel rozet GÖSTERMİYOR, API iki imza İSTİYORDU. Operatör
   * işlemin uygulandığını sanıp bekleyen talebi görmüyordu.
   */
  "tenant.plan_change": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "tenant.custom_price": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "payment.refund": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "payment.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: "masked",
  },
  "system.settings": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "system.maintenance_lock": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: "four_eyes",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "system.flag_write": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "system.flag_global_write": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: "four_eyes",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "announcement.publish": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "system.health": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "system.health.uptime": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: "masked",
  },
  "ai.analytics.platform": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: "masked",
  },
  "ai.analytics.tenant": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "support.tenant_content": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "four_eyes",
    ANALYST_READONLY: N,
  },
  "ai.provider_config": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "platform_user.manage": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // denetim bulgusu K-11: dört-göz olan alt işlemlerin KENDİ matris satırı var;
  // katalog artık matristen türetiliyor (elle senkronlanan ikinci liste yok).
  "platform_user.create": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "platform_user.credential_reset": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "platform_user.assign_super_admin": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "audit.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  /** Demo talepleri: satış hattı — destek ve operasyon takip eder. */
  "demoRequests.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "demoRequests.update": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "audit.export": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "board_report.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: "read",
  },
  "metrics.overview.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "platform_user.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "subscription.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "subscription.transition": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // denetim bulgusu K-11: iptal HER ZAMAN onaya düşer; kendi satırı olmalı.
  "subscription.cancel": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: "four_eyes",
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "plan.catalog.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: "masked",
  },
  "plan.catalog.write": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // denetim bulgusu K-11: fiyat kararı ayrı satır — dört-göz.
  "plan.catalog.price": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "invoice.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "invoice.issue": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "support_grant.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: N,
  },
  "support_grant.request": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "four_eyes",
    ANALYST_READONLY: N,
  },
  "support_grant.revoke": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: N,
  },
  "tenant.usage.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "tenant.notes": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: N,
  },
  /** D5 — büro ADI düzeltmesi (üstveri); kiracı AÇMA dört-gözünde değildir. */
  "tenant.update": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "announcement.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "approval.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "approval.decide": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },

  // --- Modül 26 (docs/moduller/26 §API Uçları) ---
  // | GET /credits/tenants | OPS, BILLING, SUPER |
  //
  // SUPPORT_AGENT SPEC TABLOSUNDA YOKTU ve `read` verilmişti: destek personeli
  // büro adını, cüzdan bakiyesini ve son 25 kredi hareketini görebiliyordu.
  // Kredi bakiyesi bir DESTEK verisi değil, ticari veridir; destek talebinin
  // çözümü için gerekmez. Spec'e döndürüldü.
  "credits.tenant.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    // Analiste tenant kimliği kapalıdır; marj raporunu takma adla görür.
    ANALYST_READONLY: N,
  },
  // | PATCH /credits/tenants/:id | BILLING, SUPER (dört-göz) |
  "credits.tenant.adjust": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "credits.pricing.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // | GET/PATCH /credits/costs · /model-prices | SUPER |
  "credits.pricing.write": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // | GET /credits/margin | BILLING, SUPER, ANALYST (salt-okur) |
  "credits.margin.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    // 🔒 masked — kabul kriteri 12: marjı GÖRÜR, fiyat listesini DEĞİŞTİREMEZ.
    // Tenant kimliği takma adla döner (Pseudonymizer).
    ANALYST_READONLY: "masked",
  },
  "judicial.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "judicial.manage": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "aiProvider.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  "aiProvider.manage": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
};

export const ACTION_LABELS: Record<AdminAction, string> = {
  "tenant.view": "Tenant listesi/detayı görüntüleme",
  "tenant.users.view": "Tenant personel listesi",
  "tenant.create": "Tenant oluşturma",
  "tenant.update": "Büro adı düzeltmesi (üstveri)",
  "tenant.suspend": "Tenant askıya alma",
  "tenant.reactivate": "Tenant aktifleştirme",
  "tenant.delete": "Tenant kalıcı silme",
  "tenant.plan_change": "Plan değiştirme",
  "tenant.custom_price": "Özel fiyat / manuel indirim",
  "payment.refund": "İade",
  "payment.view": "Ödeme/fatura detayı görüntüleme",
  "system.settings": "Sistem ayarı",
  "system.maintenance_lock": "Bakım modu tam kilidi",
  "system.flag_write": "Özellik bayrağı değişikliği",
  "system.flag_global_write": "Platform geneli bayrak değişikliği",
  "announcement.publish": "Duyuru yayınlama",
  "system.health": "Sistem sağlık panosu",
  "system.health.uptime": "Çalışma süresi satırı",
  "ai.analytics.platform": "AI analitiği — platform toplamı",
  "ai.analytics.tenant": "AI analitiği — tenant kırılımı",
  "support.tenant_content": "Tenant içeriği görüntüleme (destek erişimi)",
  "ai.provider_config": "AI sağlayıcı üstverisi",
  "platform_user.manage": "Platform kullanıcısı yönetimi",
  "platform_user.create": "Panel kullanıcısı açma",
  "platform_user.credential_reset": "Panel kullanıcısının parola/2FA sıfırlaması",
  "platform_user.assign_super_admin": "SUPER_ADMIN atama/düşürme",
  "audit.view": "Platform denetim izi görüntüleme",
  "demoRequests.view": "Demo taleplerini görüntüleme",
  "demoRequests.update": "Demo talebi durum güncelleme",
  "audit.export": "Platform denetim izi dışa aktarma",
  "board_report.view": "Kurul (yatırımcı) raporu",
  "metrics.overview.view": "Platform genel bakış KPI'ları",
  "platform_user.view": "Platform kullanıcıları listesi",
  "subscription.view": "Abonelik listesi",
  "subscription.transition": "Abonelik durum geçişi",
  "subscription.cancel": "Abonelik iptali",
  "plan.catalog.view": "Plan kataloğu görüntüleme",
  "plan.catalog.write": "Plan kataloğu düzenleme (fiyat dışı)",
  "plan.catalog.price": "Plan oluşturma / katalog fiyat değişikliği",
  "invoice.view": "Platform faturaları",
  "invoice.issue": "Fatura kesme",
  "support_grant.view": "Destek erişim kayıtları",
  "support_grant.request": "Destek erişim penceresi açma",
  "support_grant.revoke": "Destek erişimini iptal etme",
  "tenant.usage.view": "Tenant kullanım serisi",
  "tenant.notes": "Tenant iç notu",
  "announcement.view": "Duyuru listesi",
  "approval.view": "Onay kuyruğu görüntüleme",
  "approval.decide": "Onay verme / reddetme",
  "credits.tenant.view": "Kredi kotası ve tüketimi görüntüleme",
  "credits.tenant.adjust": "Manuel kredi tahsisi / düzeltme",
  "credits.pricing.view": "Kredi ve model fiyat listesi görüntüleme",
  "credits.pricing.write": "Kredi ve model fiyat listesi düzenleme",
  "credits.margin.view": "AI maliyet / gelir / marj raporu",
  "judicial.view": "Yargı organları + noter kataloğunu görüntüleme",
  "judicial.manage": "Yargı organları + noter kataloğu yönetimi",
  "aiProvider.view": "Platform AI sağlayıcılarını görüntüleme",
  "aiProvider.manage": "Platform AI sağlayıcı yönetimi",
};

/** Rol için işlem seviyesi. Bilinmeyen rol → hiçbir şey. */
export function levelOf(role: AdminRole | null | undefined, action: AdminAction): PermissionLevel {
  if (!role) return "none";
  const row = PERMISSION_MATRIX[action];
  if (!row) return "none";
  return row[role] ?? "none";
}

/** İşlem bu rol için herhangi bir biçimde (salt-okur dâhil) açık mı? */
export function can(role: AdminRole | null | undefined, action: AdminAction): boolean {
  return levelOf(role, action) !== "none";
}

/** Veri maskeli mi dönmeli? (🔒 — tenant kimliği yerine takma ad/agregat) */
export function isMasked(role: AdminRole | null | undefined, action: AdminAction): boolean {
  return levelOf(role, action) === "masked";
}

/**
 * Mutasyon yetkisi — "full" ya da "four_eyes".
 * ANALYST_READONLY için HER KOŞULDA false (sözleşme gereği sıfır yazma).
 */
export function canMutate(role: AdminRole | null | undefined, action: AdminAction): boolean {
  if (!role || role === "ANALYST_READONLY") return false;
  const lvl = levelOf(role, action);
  return lvl === "full" || lvl === "four_eyes";
}

/** İşlem bu rol için dört-göz onayı gerektiriyor mu? */
export function requiresApproval(
  role: AdminRole | null | undefined,
  action: AdminAction
): boolean {
  return levelOf(role, action) === "four_eyes";
}

/**
 * DÖRT-GÖZ İŞLEM KATALOĞU — MATRİSTEN TÜRETİLİR, ELLE YAZILMAZ.
 *
 * denetim bulgusu K-11: eskiden burada ELLE YAZILMIŞ bir liste vardı ve
 * `requiresApproval()` (matris) ile `isFourEyesAction()` (liste) ayrışmıştı:
 * liste `platform_user.manage` ve `plan.catalog.write`'ı içeriyordu, matriste
 * ikisi de "full"du. `apps/admin` ikizi iki fonksiyonu `||` ile birleştirip
 * dört-göz rozetini gösteriyor, API ise tek imzayla uyguluyordu — tutulmayan
 * bir söz, hiç söz vermemekten tehlikelidir.
 *
 * ARTIK TEK KAYNAK MATRİSTİR: bir işlem, HERHANGİ bir rol için seviyesi
 * `four_eyes` ise dört-gözdür. İki listeyi elle senkronlamak imkânsızdır,
 * çünkü ikinci liste yoktur.
 *
 * Spec §Roller listesinin 8 maddesinin tamamı bu türetmeyle karşılanır;
 * eşleşme `platform-permissions.test.ts` tarafından doğrulanır.
 */
export const FOUR_EYES_ACTIONS: readonly AdminAction[] = Object.freeze(
  (Object.keys(PERMISSION_MATRIX) as AdminAction[]).filter((action) =>
    ADMIN_ROLES.some((role) => PERMISSION_MATRIX[action][role] === "four_eyes")
  )
);

const FOUR_EYES_SET = new Set<AdminAction>(FOUR_EYES_ACTIONS);

export function isFourEyesAction(action: AdminAction): boolean {
  return FOUR_EYES_SET.has(action);
}

/**
 * Rozet/uyarı kararının TEK fonksiyonu.
 *
 * İstemci eskiden `requiresApproval(role, action) || isFourEyesAction(action)`
 * yazıyordu; iki kaynak birleşince bu ifade artık gereksizdir ama çağıranların
 * yanlışlıkla yeniden ayrışmaması için tek bir isim veriyoruz.
 */
export function needsFourEyes(
  role: AdminRole | null | undefined,
  action: AdminAction
): boolean {
  return isFourEyesAction(action) || requiresApproval(role, action);
}

/** Yatırımcı/ortak rolü — hiçbir yazma ve hiçbir tenant kimliği görmez. */
export function isAnalyst(role: AdminRole | null | undefined): boolean {
  return role === "ANALYST_READONLY";
}
