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
  | "platform_user.assign_super_admin"
  | "audit.view"
  | "audit.export"
  | "board_report.view"
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
  | "approval.decide";

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
    SUPER_ADMIN: "full",
    OPS_ADMIN: "full",
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
};

export const ACTION_LABELS: Record<AdminAction, string> = {
  "tenant.view": "Tenant listesi/detayı görüntüleme",
  "tenant.users.view": "Tenant personel listesi",
  "tenant.create": "Tenant oluşturma",
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
  "platform_user.assign_super_admin": "SUPER_ADMIN atama/düşürme",
  "audit.view": "Platform denetim izi görüntüleme",
  "audit.export": "Platform denetim izi dışa aktarma",
  "board_report.view": "Kurul (yatırımcı) raporu",
  "metrics.overview.view": "Platform genel bakış KPI'ları",
  "platform_user.view": "Platform kullanıcıları listesi",
  "subscription.view": "Abonelik listesi",
  "subscription.transition": "Abonelik durum geçişi",
  "plan.catalog.view": "Plan kataloğu görüntüleme",
  "plan.catalog.write": "Plan kataloğu düzenleme",
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
 * Dört-göz listesindeki (spec 1–8) işlemler — ROLDEN BAĞIMSIZ olarak
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
  /**
   * Denetim bulgularıyla eklenenler:
   *   - panel personeli açmak ve başkasının kimlik bilgisini sıfırlamak,
   *     dört-göz için gereken "ikinci insanı" tek kişinin üretmesini engeller
   *     (bulgu 1);
   *   - katalog fiyatı tüm kiracıları etkiler, tek büroya indirimden daha
   *     geniştir (bulgu 9).
   */
  "platform_user.manage",
  "plan.catalog.write",
];

export function isFourEyesAction(action: AdminAction): boolean {
  return FOUR_EYES_ACTIONS.includes(action);
}

/** Yatırımcı/ortak rolü — hiçbir yazma ve hiçbir tenant kimliği görmez. */
export function isAnalyst(role: AdminRole | null | undefined): boolean {
  return role === "ANALYST_READONLY";
}
