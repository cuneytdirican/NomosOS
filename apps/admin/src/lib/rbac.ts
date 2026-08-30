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
  | "platform_user.assign_super_admin"
  | "audit.view"
  | "audit.export"
  | "board_report.view"
  // --- API uç tablosundan türeyen ek işlemler ---
  | "metrics.overview.view"
  | "platform_user.view"
  | "subscription.view"
  | "subscription.transition"
  | "plan.catalog.view"
  | "plan.catalog.write"
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
  | "credits.margin.view";

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
  "tenant.plan_change": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: N,
    BILLING_ADMIN: "full",
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
  "platform_user.assign_super_admin": {
    SUPER_ADMIN: "four_eyes",
    OPS_ADMIN: N,
    BILLING_ADMIN: N,
    SUPPORT_AGENT: N,
    ANALYST_READONLY: N,
  },
  // | PlatformAuditLog görüntüle / dışa aktar | ✅ / 4️⃣ | 👁 (kendi alanı) | 👁 (finans) | 👁 (kendi işlemleri) | ❌ |
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
  "credits.tenant.view": {
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
    BILLING_ADMIN: "full",
    SUPPORT_AGENT: "read",
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
  "platform_user.manage": "Platform kullanıcısı oluştur / rol ata",
  "platform_user.assign_super_admin": "SUPER_ADMIN atama / düşürme",
  "audit.view": "PlatformAuditLog görüntüle",
  "audit.export": "PlatformAuditLog dışa aktar",
  "board_report.view": "Kurul Raporu",
  "metrics.overview.view": "Platform genel bakış KPI'ları",
  "platform_user.view": "Platform kullanıcıları listesi",
  "subscription.view": "Abonelik listesi",
  "subscription.transition": "Abonelik durum geçişi",
  "plan.catalog.view": "Plan kataloğu görüntüle",
  "plan.catalog.write": "Plan kataloğu düzenle",
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
 * Dört-göz listesindeki (spec 1–8) işlemler — rolden bağımsız olarak
 * her zaman ikinci bir kişinin onayıyla tamamlanır.
 */
export const FOUR_EYES_ACTIONS: readonly AdminAction[] = [
  "tenant.delete",
  "tenant.suspend",
  "payment.refund",
  "tenant.custom_price",
  "support_grant.request",
  "system.maintenance_lock",
  "system.flag_global_write",
  "platform_user.assign_super_admin",
  "audit.export",
  // Denetim bulguları 1 ve 9: panel personeli açma / kimlik bilgisi sıfırlama
  // ve katalog fiyatı değişikliği de iki imza ister.
  "platform_user.manage",
  "plan.catalog.write",
  // Modül 26: kredi paraya eşdeğerdir; tek imzayla yaratılamaz.
  "credits.tenant.adjust",
];

export function isFourEyesAction(action: AdminAction): boolean {
  return FOUR_EYES_ACTIONS.includes(action);
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
