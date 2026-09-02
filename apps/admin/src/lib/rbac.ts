/**
 * Platform yetki matrisi — docs/moduller/25-sistem-yonetim-paneli.md "Roller ve Yetki Matrisi"
 * bölümünün bire bir kodlanmış hâli.
 *
 * İLKELER
 * 1. Varsayılan read-only: matriste açıkça verilmeyen her işlem "none"dır.
 * 2. Hiyerarşi düz değildir, alan ayrımıdır (segregation of duties):
 *    operasyonu yöneten iade yapamaz, parayı yöneten tenant silemez.
 * 3. ANALYST_READONLY (yatırımcı/ortak) hiçbir koşulda mutasyon göremez; tenant kimliği,
 *    müvekkil/dosya verisi, tekil ödeme detayı ve denetim izi bu role KAPALIDIR.
 * 4. Buradaki gizleme yalnız ergonomidir; asıl yaptırım API katmanındadır
 *    (PlatformRoleGuard + FourEyesGuard). UI ile API aynı tanımı kullanmalıdır.
 */

export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "OPS_ADMIN",
  "BILLING_ADMIN",
  "SUPPORT_AGENT",
  "ANALYST_READONLY",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Yetki seviyeleri (spec gösterimi):
 *  full       ✅  tam yetki
 *  read       👁  salt-okur
 *  masked     🔒  maskeli / yalnız toplulaştırılmış salt-okur
 *  four_eyes  4️⃣  yapılabilir ama dört-göz onayı (talep eden ≠ onaylayan) gerekir
 *  none       ❌  yok
 */
export type PermissionLevel = "full" | "read" | "masked" | "four_eyes" | "none";

export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  full: "Tam yetki",
  read: "Salt-okur",
  masked: "Maskeli / toplulaştırılmış",
  four_eyes: "Dört-göz onayı gerekir",
  none: "Yetki yok",
};

export const PERMISSION_LEVEL_SYMBOLS: Record<PermissionLevel, string> = {
  full: "✓",
  read: "👁",
  masked: "🔒",
  four_eyes: "4️⃣",
  none: "—",
};

export type AdminAction =
  // --- Yetki matrisi satırları (spec tablosu) ---
  | "tenant.view"
  /** Büro PERSONEL listesi — `tenant.view`'dan ayrıdır (alan ayrımı). */
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
  // denetim bulgusu K-11: dört-göz olan alt işlemler ayrı satır oldu; katalog
  // artık matristen TÜRETİLİYOR (elle senkronlanan ikinci liste kaldırıldı).
  | "platform_user.create"
  | "platform_user.credential_reset"
  | "platform_user.assign_super_admin"
  | "demoRequests.view"
  | "demoRequests.update"
  | "audit.view"
  | "audit.export"
  | "board_report.view"
  // --- API uç tablosundan türeyen ek işlemler ---
  | "metrics.overview.view"
  | "platform_user.view"
  | "subscription.view"
  | "subscription.transition"
  // denetim bulgusu K-11: iptal terminaldir ve her zaman onaya düşer.
  | "subscription.cancel"
  | "plan.catalog.view"
  | "plan.catalog.write"
  // denetim bulgusu K-11: fiyat koymak/değiştirmek TÜM kiracıları etkiler.
  | "plan.catalog.price"
  | "invoice.view"
  | "invoice.issue"
  | "support_grant.view"
  | "support_grant.request"
  | "support_grant.revoke"
  | "tenant.usage.view"
  | "tenant.notes"
  | "announcement.view"
  | "approval.view"
  | "approval.decide"
  // --- Modül 26: AI kota ve kredi sistemi ---
  /** Tenant başına kredi kotası ve tüketimi. */
  | "credits.tenant.view"
  /** Manuel kredi tahsisi/düzeltme — her rolde dört-göz. */
  | "credits.tenant.adjust"
  /** Kredi ve model fiyat listesi — okuma. */
  | "credits.pricing.view"
  /** Kredi ve model fiyat listesi — yazma (SUPER_ADMIN). */
  | "credits.pricing.write"
  /** Maliyet / gelir / marj raporu — ANALYST_READONLY takma adlı görür. */
  | "credits.margin.view"
  /** Yargı organları + noterler referans kataloğu — okuma (panel listesi). */
  | "judicial.view"
  /** Katalog yönetimi: ekleme/düzeltme, senkron ayarı ve tetikleme. */
  | "judicial.manage";

type Matrix = Record<AdminAction, Record<AdminRole, PermissionLevel>>;

const N: PermissionLevel = "none";

/**
 * Matris — sıra ve değerler spec tablosuyla birebir.
 * S = SUPER_ADMIN, O = OPS_ADMIN, B = BILLING_ADMIN, D = SUPPORT_AGENT, A = ANALYST_READONLY
 */
export const PERMISSION_MATRIX: Matrix = {
  // | Tenant listesi/detayı görüntüle | ✅ | ✅ | ✅ (finans odaklı) | ✅ | 🔒 (yalnız plan/segment agregatı) |
  "tenant.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: "masked",
  },
  // Büro personel listesi — faturalama rolüne KAPALI (denetim bulgusu 18).
  "tenant.users.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: N,
  },
  // | Tenant oluştur (manuel onboarding) | ✅ | ✅ | ❌ | ❌ | ❌ |
  "tenant.create": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // | Tenant askıya al / aktifleştir | ✅ | 4️⃣ | 4️⃣ (yalnız ödeme temerrüdü) | ❌ | ❌ |
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
  // | Tenant kalıcı sil / veri imhası | 4️⃣ | ❌ | ❌ | ❌ | ❌ |  (iki SUPER_ADMIN)
  "tenant.delete": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // | Plan değiştir / özel fiyat | ✅ / ✅ | ❌ | ✅ / 4️⃣ | ❌ | ❌ |
  // denetim bulgusu K-11: PATCH /subscriptions/:id her zaman onaya düşer.
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
  // | İade (refund) | 4️⃣ | ❌ | 4️⃣ | ❌ | ❌ |
  "payment.refund": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // | Ödeme/fatura detayı görüntüle | ✅ | ❌ | ✅ | 👁 (yalnız ödendi/ödenmedi) | 🔒 (MRR/churn özetleri) |
  "payment.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: "masked",
  },
  // | Sistem ayarı, bakım modu, feature flag | ✅ | ✅ (bakım tam kilidi 4️⃣) | ❌ | ❌ | ❌ |
  "system.settings": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // Dört-göz listesi #6: bakım modu TAM KİLİDİ her rol için dört-göz.
  "system.maintenance_lock": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: "four_eyes",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // Flag: tenant override / yüzdesel rollout normal yazma.
  "system.flag_write": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // Dört-göz listesi #6: platform GENELİ flag / rate-limit değişikliği.
  "system.flag_global_write": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: "four_eyes",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // | Duyuru yayınla | ✅ | ✅ | ❌ | ❌ | ❌ |
  "announcement.publish": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // | Sistem sağlık panosu | ✅ | ✅ | ❌ | 👁 | ❌ (yalnız uptime satırı) |
  "system.health": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  // Yukarıdaki satırın parantezi: ANALYST_READONLY yalnız uptime yüzdesini görür.
  "system.health.uptime": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: "masked",
  },
  // | AI analitiği — platform toplamı | ✅ | ✅ | 👁 | 👁 | 🔒 (tenant kimliği takma adlı) |
  "ai.analytics.platform": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: "masked",
  },
  // | AI analitiği — tenant detayı | ✅ | ✅ | 👁 (hacim) | 👁 (destek bağlamında) | ❌ |
  "ai.analytics.tenant": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  // | Tenant içeriği görüntüle (destek erişimi) | 4️⃣ + süreli grant | ❌ | ❌ | 4️⃣ + süreli grant, PII maskeli | ❌ asla |
  "support.tenant_content": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "four_eyes",
    ANALYST_READONLY: N,
  },
  // | AiProviderConfig metadata (anahtar asla) | ✅ | 👁 | ❌ | 👁 | ❌ |
  "ai.provider_config": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  // | Platform kullanıcısı oluştur / rol ata | ✅ (SUPER_ADMIN ataması 4️⃣) | ❌ | ❌ | ❌ | ❌ |
  "platform_user.manage": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
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
  // | PlatformAuditLog görüntüle / dışa aktar | ✅ / 4️⃣ | 👁 (kendi alanı) | 👁 (finans) | 👁 (kendi işlemleri) | ❌ |
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
  "audit.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "read",
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
  // | Kurul Raporu (yatırımcı seti) | ✅ | ❌ | ✅ | ❌ | 👁 (bu rolün tek ekranı) |
  "board_report.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: "read",
  },

  // ---------- API uç tablosundan türeyenler ----------

  // GET /metrics/overview → S O B D  (A: Kurul Raporu'na yönlendirilir)
  "metrics.overview.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  // GET /platform-users → S
  "platform_user.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // GET /subscriptions → S O B
  "subscription.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // POST /subscriptions/:id/transition → S O B (askıya alma geçişi ayrıca dört-göz)
  "subscription.transition": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  "subscription.cancel": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: "four_eyes",
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // GET /plans → S O B D A
  "plan.catalog.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: "masked",
  },
  // POST/PATCH /plans → S B
  "plan.catalog.write": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // POST /plans + PATCH /plans/:id (fiyat) → S B, dört-göz
  "plan.catalog.price": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: "four_eyes",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // GET /invoices → S B
  "invoice.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // POST /invoices/:id/issue → S B
  "invoice.issue": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // GET /support-grants → D O S
  "support_grant.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: N,
  },
  // POST /support-grants → dört-göz + tenant ADMIN onayı
  "support_grant.request": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "four_eyes",
    ANALYST_READONLY: N,
  },
  // PATCH /support-grants/:id/revoke → erken iptal her zaman serbesttir (kısıtlayıcı yön)
  "support_grant.revoke": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: N,
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: N,
  },
  // GET /tenants/:id/usage → S O B D
  "tenant.usage.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  // GET/POST /tenants/:id/notes → S O B D
  "tenant.notes": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: "full",
    ANALYST_READONLY: N,
  },
  // GET /announcements → S O B D
  "announcement.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  // GET /approvals → ilgili roller
  "approval.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "read",
    BILLING_ADMIN: "read",
    SUPPORT_AGENT: "read",
    ANALYST_READONLY: N,
  },
  // PATCH /approvals/:id → onay/red; talep eden kendi talebini onaylayamaz (ayrıca kontrol edilir)
  "approval.decide": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },

  // --- Modül 26 (docs/moduller/26 §API Uçları) ---
  // denetim bulgusu Ö-32: SUPPORT_AGENT burada "read"di, sunucuda "none".
  // Kredi bakiyesi bir DESTEK verisi değil, TİCARİ veridir; destek talebinin
  // çözümü için gerekmez. Sunucu spec'e döndürülmüştü, istemci geride kalmıştı;
  // destek personeli var olmayan bir yetkiyi görüp her tıklamada 403 duvarına
  // çarpıyordu. İki matrisin ayrışması artık testle yakalanıyor.
  "credits.tenant.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
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
  "credits.pricing.write": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // Kabul kriteri 12: marjı GÖRÜR, fiyat listesini DEĞİŞTİREMEZ.
  "credits.margin.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: N,
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
};

/** İşlem etiketleri — onay kuyruğu ve yetki matrisi ekranında Türkçe gösterim. */
export const ACTION_LABELS: Record<AdminAction, string> = {
  "tenant.view": "Tenant listesi/detayı görüntüle",
  "tenant.users.view": "Tenant personel listesi",
  "tenant.create": "Tenant oluştur (manuel onboarding)",
  "tenant.suspend": "Tenant askıya al",
  "tenant.reactivate": "Tenant aktifleştir",
  "tenant.delete": "Tenant kalıcı sil / veri imhası",
  "tenant.plan_change": "Plan değiştir",
  "tenant.custom_price": "Özel fiyat / manuel indirim",
  "payment.refund": "İade (refund)",
  "payment.view": "Ödeme/fatura detayı görüntüle",
  "system.settings": "Sistem ayarı ve bakım modu",
  "system.maintenance_lock": "Bakım modu tam kilidi",
  "system.flag_write": "Feature flag (tenant/yüzdesel) değişikliği",
  "system.flag_global_write": "Platform geneli flag / rate-limit değişikliği",
  "announcement.publish": "Duyuru yayınla",
  "system.health": "Sistem sağlık panosu",
  "system.health.uptime": "Uptime satırı",
  "ai.analytics.platform": "AI analitiği — platform toplamı",
  "ai.analytics.tenant": "AI analitiği — tenant detayı",
  "support.tenant_content": "Tenant içeriği görüntüle (destek erişimi)",
  "ai.provider_config": "AI sağlayıcı metadata (anahtar asla)",
  "platform_user.manage": "Platform kullanıcısı yönetimi",
  "platform_user.create": "Panel kullanıcısı açma",
  "platform_user.credential_reset": "Panel kullanıcısının parola/2FA sıfırlaması",
  "platform_user.assign_super_admin": "SUPER_ADMIN atama / düşürme",
  "audit.view": "PlatformAuditLog görüntüle",
  "demoRequests.view": "Demo taleplerini görüntüle",
  "demoRequests.update": "Demo talebi durum güncelle",
  "audit.export": "PlatformAuditLog dışa aktar",
  "board_report.view": "Kurul Raporu",
  "metrics.overview.view": "Platform genel bakış KPI'ları",
  "platform_user.view": "Platform kullanıcıları listesi",
  "subscription.view": "Abonelik listesi",
  "subscription.transition": "Abonelik durum geçişi",
  "subscription.cancel": "Abonelik iptali",
  "plan.catalog.view": "Plan kataloğu görüntüle",
  "plan.catalog.write": "Plan kataloğu düzenleme (fiyat dışı)",
  "plan.catalog.price": "Plan oluşturma / katalog fiyat değişikliği",
  "invoice.view": "Platform faturaları",
  "invoice.issue": "Fatura kesme (DRAFT → ISSUED)",
  "support_grant.view": "Destek erişim kayıtları",
  "support_grant.request": "Destek erişim penceresi aç",
  "support_grant.revoke": "Destek erişimini iptal et",
  "tenant.usage.view": "Tenant kullanım serisi",
  "tenant.notes": "Tenant iç notları",
  "announcement.view": "Duyuru listesi",
  "approval.view": "Onay kuyruğu görüntüle",
  "approval.decide": "Onay ver / reddet",
  "credits.tenant.view": "Kredi kotası ve tüketimi görüntüleme",
  "credits.tenant.adjust": "Manuel kredi tahsisi / düzeltme",
  "credits.pricing.view": "Kredi ve model fiyat listesi görüntüleme",
  "credits.pricing.write": "Kredi ve model fiyat listesi düzenleme",
  "credits.margin.view": "AI maliyet / gelir / marj raporu",
  "judicial.view": "Yargı organları + noter kataloğunu görüntüleme",
  "judicial.manage": "Yargı organları + noter kataloğu yönetimi",
};

/** Rol için işlem seviyesi. Bilinmeyen rol → hiçbir şey. */
export function levelOf(role: AdminRole | null | undefined, action: AdminAction): PermissionLevel {
  if (!role) return "none";
  const row = PERMISSION_MATRIX[action];
  if (!row) return "none";
  return row[role] ?? "none";
}

/**
 * `can(role, action)` — işlem bu rol için herhangi bir biçimde (salt-okur dahil) açık mı?
 * Düğme/menü gösterimi bu fonksiyonla kararlaştırılır.
 */
export function can(role: AdminRole | null | undefined, action: AdminAction): boolean {
  return levelOf(role, action) !== "none";
}

/** Salt-okur/maskeli görüş mü? (yazma yok ama ekran açılır) */
export function isReadOnly(role: AdminRole | null | undefined, action: AdminAction): boolean {
  const lvl = levelOf(role, action);
  return lvl === "read" || lvl === "masked";
}

/** Veri maskeli mi gösterilmeli? (🔒 — tenant kimliği yerine OTURUM KAPSAMLI takma ad; anonim değildir) */
export function isMasked(role: AdminRole | null | undefined, action: AdminAction): boolean {
  return levelOf(role, action) === "masked";
}

/**
 * Mutasyon yetkisi — "full" ya da "four_eyes".
 * ANALYST_READONLY için her koşulda false (sözleşme gereği sıfır yazma).
 */
export function canMutate(role: AdminRole | null | undefined, action: AdminAction): boolean {
  if (!role || role === "ANALYST_READONLY") return false;
  const lvl = levelOf(role, action);
  return lvl === "full" || lvl === "four_eyes";
}

/** İşlem bu rol için dört-göz onayı gerektiriyor mu? */
export function requiresApproval(
  role: AdminRole | null | undefined,
  action: AdminAction,
): boolean {
  return levelOf(role, action) === "four_eyes";
}

/**
 * DÖRT-GÖZ İŞLEM KATALOĞU — MATRİSTEN TÜRETİLİR, ELLE YAZILMAZ.
 *
 * denetim bulgusu K-11: burada ELLE YAZILMIŞ bir liste vardı ve matrisle
 * ayrışmıştı (`platform_user.manage`, `plan.catalog.write` listede vardı ama
 * matriste "full"du). `ApprovalBadge` iki kaynağı `||` ile birleştirdiği için
 * panel dört-göz rozetini gösteriyor, API tek imzayla uyguluyordu. Artık tek
 * kaynak matristir; `apps/api/src/platform/platform-permissions.ts` ikizi de
 * aynı türetmeyi yapar ve iki dosyanın ayrışması testle yakalanır.
 */
export const FOUR_EYES_ACTIONS: readonly AdminAction[] = Object.freeze(
  (Object.keys(PERMISSION_MATRIX) as AdminAction[]).filter((action) =>
    ADMIN_ROLES.some((role) => PERMISSION_MATRIX[action][role] === "four_eyes"),
  ),
);

const FOUR_EYES_SET = new Set<AdminAction>(FOUR_EYES_ACTIONS);

export function isFourEyesAction(action: AdminAction): boolean {
  return FOUR_EYES_SET.has(action);
}

/**
 * Rozet/uyarı kararının TEK fonksiyonu — çağıranlar artık iki fonksiyonu
 * `||` ile birleştirmez (denetim bulgusu K-11).
 */
export function needsFourEyes(
  role: AdminRole | null | undefined,
  action: AdminAction,
): boolean {
  return isFourEyesAction(action) || requiresApproval(role, action);
}

/** Yatırımcı/ortak rolü — hiçbir yazma işlemi ve hiçbir tenant kimliği görmez. */
export function isAnalyst(role: AdminRole | null | undefined): boolean {
  return role === "ANALYST_READONLY";
}

/** Bilinmeyen string'i güvenli biçimde role çevirir. */
export function parseRole(value: string | null | undefined): AdminRole | null {
  if (!value) return null;
  return (ADMIN_ROLES as readonly string[]).includes(value) ? (value as AdminRole) : null;
}

/** Dört-göz kuralı: talep eden kendi talebini onaylayamaz. */
export function canApproveRequest(
  role: AdminRole | null | undefined,
  currentUserId: string | undefined,
  requestedById: string,
): boolean {
  if (!can(role, "approval.decide")) return false;
  if (!currentUserId) return false;
  return currentUserId !== requestedById;
}
