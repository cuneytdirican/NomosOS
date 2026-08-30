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
  /**
   * PANEL PERSONELİ AÇMA — HER ROL İÇİN.
   *
   * Eskiden yalnız SUPER_ADMIN ataması dört-göze tabiydi; diğer roller
   * DOĞRUDAN açılıyordu ve parolayı açan kişi biliyordu. Bu, dört-göz kuralını
   * tek kişiyle delmenin en kısa yoluydu: A, kendi iade talebini onaylatmak
   * için `payment.refund` yetkili bir BILLING_ADMIN açar ve o kimlikle kendi
   * talebini onaylardı (denetim bulgusu 1). Dört-göz "iki ayrı İNSAN"
   * garantisidir; onay verebilecek bir kimliği tek kişinin ÜRETEBİLMESİ bu
   * garantiyi sıfırlar. Panel personeli açmak zaten nadir bir işlemdir.
   */
  PLATFORM_USER_CREATE: "PLATFORM_USER_CREATE",
  /**
   * BAŞKASININ PAROLASINI / 2FA KAYDINI SIFIRLAMA.
   *
   * Aynı bulgunun ikinci yarısı: rol değişmediği için SUPER_ADMIN onay
   * kuyruğu hiç tetiklenmiyordu ve bir SUPER_ADMIN, başka bir SUPER_ADMIN'in
   * parolasını + 2FA'sını tek istekte sıfırlayıp o kimliğe geçebiliyordu.
   * KENDİ parolası bu yoldan DEĞİL, `POST /auth/change-password` ucundan
   * (mevcut parola + TOTP ile) değişir.
   */
  PLATFORM_USER_CREDENTIAL_RESET: "PLATFORM_USER_CREDENTIAL_RESET",
  /**
   * PLAN KATALOĞU FİYAT DEĞİŞİKLİĞİ.
   *
   * `tenant.custom_price` (tek büroya indirim) dört-gözdü ama
   * `plan.catalog.write` "full"du: TEK BİR imzayla TÜM katalog fiyatı
   * değiştirilebiliyordu (denetim bulgusu 9). Yetki eşiği "kaç kiracıyı ve ne
   * kadar parayı etkiliyor" ölçüsüne göre belirlenir; bir büroya indirim iki
   * imza isterken bütün bürolara indirim bir imza isteyemez.
   * Ad/açıklama/`isActive` değişiklikleri doğrudan kalır.
   */
  PLAN_PRICE_CHANGE: "PLAN_PRICE_CHANGE",
  /**
   * MANUEL KREDİ TAHSİSİ / DÜZELTME (Modül 26, iş kuralı 9).
   *
   * Kredi paraya eşdeğerdir: bir panel kullanıcısı tek imzayla bir büroya
   * 10.000 kredi yazabilseydi, iadeyi dört-göze bağlamanın anlamı kalmazdı
   * (aynı değeri kredi olarak vermek serbest olurdu). BYO-LLM muafiyeti de
   * bu talebe dâhildir; muafiyet, kotayı tamamen kaldıran bir ticari karardır.
   */
  CREDIT_MANUAL_ADJUST: "CREDIT_MANUAL_ADJUST",
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
  PLATFORM_USER_CREATE: "platform_user.manage",
  PLATFORM_USER_CREDENTIAL_RESET: "platform_user.manage",
  PLAN_PRICE_CHANGE: "plan.catalog.write",
  CREDIT_MANUAL_ADJUST: "credits.tenant.adjust",
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
  PLATFORM_USER_CREATE: "Panel kullanıcısı açma",
  PLATFORM_USER_CREDENTIAL_RESET: "Panel kullanıcısının parola/2FA sıfırlaması",
  PLAN_PRICE_CHANGE: "Plan kataloğu fiyat değişikliği",
  CREDIT_MANUAL_ADJUST: "Manuel kredi tahsisi / kota düzeltmesi",
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

/** Panel personeli açma (SUPER_ADMIN dışındaki roller de dâhil). */
export interface PlatformUserCreatePayload {
  newUser: { email: string; fullName: string; passwordHash: string; role: string };
  reason: string;
}

/** Başkasının parolasını / 2FA kaydını sıfırlama. */
export interface PlatformUserCredentialResetPayload {
  targetUserId: string;
  /** Yeni parola HASH'i (düz metin ASLA payload'a girmez). */
  passwordHash?: string;
  /** 2FA kaydı sıfırlansın mı? */
  resetTwoFactor?: boolean;
  reason: string;
}

/** Plan kataloğu fiyat değişikliği (tüm kiracıları etkiler). */
export interface PlanPriceChangePayload {
  planId: string;
  /** null → fiyat kaldırılıyor ("fiyatsız" plan). */
  monthlyPricePerUser: string | null;
  reason: string;
}

/**
 * Manuel kredi tahsisi / kota düzeltmesi (Modül 26).
 * Alanların hepsi opsiyoneldir; talep en az birini taşımak zorundadır
 * (uç tarafında Zod ile zorlanır, executor ayrıca kendi kapısını kurar).
 */
export interface CreditManualAdjustPayload {
  tenantId: string;
  /** Satın alınmış bakiyeye eklenecek/çıkarılacak kredi. */
  deltaCredits?: number;
  /** Dönem dahil kotasını yeniden belirle (Enterprise sözleşmeleri). */
  includedCredits?: number;
  documentQuota?: number;
  /** BYO-LLM muafiyeti — kredi kapısı tamamen devre dışı kalır. */
  byoLlm?: boolean;
  /** Dönemi yenile: dahil kota sıfırlanır, satın alınan bakiye korunur. */
  renewPeriod?: boolean;
  reason: string;
}
