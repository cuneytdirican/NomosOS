import type { AdminAction } from "../platform-permissions";

/**
 * DÖRT-GÖZ (two-person rule) İŞLEM KATALOĞU.
 *
 * Spec §Roller "Dört-göz ilkesi" listesi (1–8) + `apps/admin/src/lib/rbac.ts`
 * `FOUR_EYES_ACTIONS`. Bu işlemler TEK KİŞİYLE tamamlanamaz: uç, işlemi
 * yapmak yerine bir `PlatformApprovalRequest` üretir; FARKLI bir yetkili
 * onaylayınca payload GERÇEKTEN uygulanır.
 *
 * `payloadJson` içinde SIR TUTULMAZ (parolalar hash'lenmiş olarak girer).
 */
export const APPROVAL_ACTIONS = {
  TENANT_SUSPEND: "TENANT_SUSPEND",
  TENANT_ACTIVATE: "TENANT_ACTIVATE",
  SUBSCRIPTION_PLAN_CHANGE: "SUBSCRIPTION_PLAN_CHANGE",
  SUBSCRIPTION_CANCEL: "SUBSCRIPTION_CANCEL",
  PAYMENT_REFUND: "PAYMENT_REFUND",
  SUPPORT_ACCESS_GRANT: "SUPPORT_ACCESS_GRANT",
  SYSTEM_MAINTENANCE_LOCK: "SYSTEM_MAINTENANCE_LOCK",
  FEATURE_FLAG_GLOBAL: "FEATURE_FLAG_GLOBAL",
  PLATFORM_USER_SUPER_ADMIN: "PLATFORM_USER_SUPER_ADMIN",
} as const;

export type ApprovalActionKey = (typeof APPROVAL_ACTIONS)[keyof typeof APPROVAL_ACTIONS];

/**
 * Onay talebini ONAYLAYACAK kişinin taşıması gereken yetki.
 *
 * Onaylayan, işlemi kendi başına yapabilecek yetkiye sahip olmalıdır; aksi
 * hâlde dört-göz kuralı "yetkisiz ikinci imza" ile delinirdi. Örneğin bir
 * SUPPORT_AGENT iade talebini onaylayamaz (payment.refund → none).
 */
export const APPROVAL_REQUIRED_PERMISSION: Record<ApprovalActionKey, AdminAction> = {
  TENANT_SUSPEND: "tenant.suspend",
  TENANT_ACTIVATE: "tenant.reactivate",
  SUBSCRIPTION_PLAN_CHANGE: "tenant.plan_change",
  SUBSCRIPTION_CANCEL: "subscription.transition",
  PAYMENT_REFUND: "payment.refund",
  SUPPORT_ACCESS_GRANT: "support_grant.request",
  SYSTEM_MAINTENANCE_LOCK: "system.maintenance_lock",
  FEATURE_FLAG_GLOBAL: "system.flag_global_write",
  PLATFORM_USER_SUPER_ADMIN: "platform_user.assign_super_admin",
};

export const APPROVAL_LABELS: Record<ApprovalActionKey, string> = {
  TENANT_SUSPEND: "Tenant askıya alma",
  TENANT_ACTIVATE: "Tenant aktifleştirme",
  SUBSCRIPTION_PLAN_CHANGE: "Plan / koltuk değişikliği",
  SUBSCRIPTION_CANCEL: "Abonelik iptali",
  PAYMENT_REFUND: "Ödeme iadesi",
  SUPPORT_ACCESS_GRANT: "Destek erişim penceresi açma",
  SYSTEM_MAINTENANCE_LOCK: "Bakım modu tam kilidi",
  FEATURE_FLAG_GLOBAL: "Platform geneli özellik bayrağı",
  PLATFORM_USER_SUPER_ADMIN: "SUPER_ADMIN atama",
};

export function isApprovalAction(value: string): value is ApprovalActionKey {
  return Object.prototype.hasOwnProperty.call(APPROVAL_REQUIRED_PERMISSION, value);
}

// ---------------------------------------------------------------------------
// Payload sözleşmeleri — executor bunları okur.
// ---------------------------------------------------------------------------

export interface TenantStatusPayload {
  tenantId: string;
  reason: string;
}

export interface SubscriptionPlanChangePayload {
  subscriptionId: string;
  planKey?: string;
  seats?: number;
  reason: string;
}

export interface SubscriptionCancelPayload {
  subscriptionId: string;
  reason: string;
}

export interface PaymentRefundPayload {
  paymentId: string;
  reason: string;
}

export interface SupportAccessPayload {
  tenantId: string;
  /** Erişimi KULLANACAK panel kullanıcısı (talebi açan kişi). */
  platformUserId: string;
  reason: string;
  scope: string;
  hours: number;
}

export interface MaintenanceLockPayload {
  enabled: boolean;
  message?: string;
  reason: string;
}

export interface FeatureFlagGlobalPayload {
  flagId: string;
  isEnabledGlobally: boolean;
  reason: string;
}

export interface SuperAdminPayload {
  /** Var olan kullanıcıyı yükseltme. */
  targetUserId?: string;
  /** Yeni kullanıcı oluşturma (parola HASH'lenmiş gelir, düz metin ASLA). */
  newUser?: { email: string; fullName: string; passwordHash: string };
  reason: string;
}
