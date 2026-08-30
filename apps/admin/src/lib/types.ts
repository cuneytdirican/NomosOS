/**
 * Platform API (/api/admin/v1) yanıt tipleri.
 *
 * Alan adları packages/db şemasındaki modellerden türetilmiştir
 * (PlatformUser, Subscription, PaymentRecord, PlatformApprovalRequest,
 *  SystemSetting, FeatureFlag, Announcement, UsageSnapshot,
 *  SupportAccessGrant, PlatformAuditLog).
 *
 * İKİ NOT:
 * 1) Prisma Decimal alanları JSON'a STRING olarak dönebilir ("40000.00").
 *    Bu yüzden parasal alanlar `Money = string | number | null` tipindedir;
 *    biçimlendirme `fmtMoney` ile yapılır, aritmetik yapılmaz.
 * 2) BigInt (`UsageSnapshot.storageBytes`) JSON'a string olarak dönebilir.
 *    Bu yüzden `BytesValue = string | number | null`.
 *
 * Sunucu tarafı hâlâ yazılırken bazı alanlar eksik gelebilir; tüm türetilmiş
 * alanlar opsiyoneldir ve ekranda "—" olarak gösterilir. Uydurma varsayılan YOKTUR.
 */

export type Iso = string;
export type Money = string | number | null;
export type BytesValue = string | number | null;

// ---------------------------------------------------------------- Kimlik

export interface AdminUserProfile {
  id: string;
  email: string;
  fullName: string;
  /** PlatformRole — bkz. rbac.ts */
  role: string;
  isActive?: boolean;
  twoFactorEnabled?: boolean;
  lastLoginAt?: Iso | null;
}

/**
 * POST /auth/login yanıtı.
 * - Şifre doğru ve 2FA gerekmiyorsa: { token, user }
 * - 2FA gerekiyorsa: { twoFactorRequired: true } (veya 401 + code TOTP_REQUIRED)
 */
export interface LoginResponse {
  token?: string;
  accessToken?: string;
  access_token?: string;
  user?: AdminUserProfile;
  twoFactorRequired?: boolean;
  totpRequired?: boolean;
  requiresTwoFactor?: boolean;
  requiresTotp?: boolean;
}

// ---------------------------------------------------------------- Tenant

export interface AdminTenantRow {
  id: string;
  name: string;
  createdAt?: Iso;
  updatedAt?: Iso;
  /** Tenant.aiPolicy — SERBEST | SADECE_YEREL */
  aiPolicy?: string | null;
  autoMaskConsent?: boolean | null;

  // Subscription (tenantId @unique) üzerinden birleştirilir
  planKey?: string | null;
  status?: string | null;
  seats?: number | null;
  trialEndsAt?: Iso | null;
  currentPeriodStart?: Iso | null;
  currentPeriodEnd?: Iso | null;

  // Toplulaştırılmış sayaçlar (UsageSnapshot / count)
  userCount?: number | null;
  clientCount?: number | null;
  caseCount?: number | null;
  documentCount?: number | null;
  storageBytes?: BytesValue;
  aiCallCount?: number | null;
  activeUsers?: number | null;
  lastActivityAt?: Iso | null;

  // Finans
  mrr?: Money;
  openBalance?: Money;
}

export interface AdminAiProviderMeta {
  id: string;
  providerType: string;
  model?: string | null;
  /** API anahtarı ASLA dönmez; yalnız varlığı bildirilir. */
  hasApiKey?: boolean;
  isActive?: boolean;
  baseUrl?: string | null;
}

export interface AdminTenantDetail extends AdminTenantRow {
  subscription?: AdminSubscription | null;
  aiProviders?: AdminAiProviderMeta[];
  usersByRole?: Record<string, number> | null;
}

// ------------------------------------------------------------ Abonelik

export interface AdminSubscription {
  id: string;
  tenantId: string;
  tenantName?: string | null;
  /** PlanTier.key — FK değildir, uygulama katmanında eşlenir. */
  planKey: string;
  /** SubscriptionStatus: TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELED */
  status: string;
  seats?: number | null;
  trialEndsAt?: Iso | null;
  currentPeriodStart?: Iso | null;
  currentPeriodEnd?: Iso | null;
  canceledAt?: Iso | null;
  note?: string | null;
  mrr?: Money;
  monthlyPricePerUser?: Money;
  createdAt?: Iso;
  updatedAt?: Iso;
}

// --------------------------------------------------------------- Ödeme

export interface AdminPaymentRecord {
  id: string;
  tenantId: string;
  tenantName?: string | null;
  subscriptionId?: string | null;
  amount: Money;
  currency?: string | null;
  /** PlatformPaymentStatus: BEKLIYOR | BASARILI | BASARISIZ | IADE */
  status: string;
  method?: string | null;
  providerRef?: string | null;
  paidAt?: Iso | null;
  failureReason?: string | null;
  attempt?: number | null;
  createdAt: Iso;
}

export interface AdminInvoiceRecord {
  id: string;
  tenantId: string;
  tenantName?: string | null;
  /** Global unique — tenant içi değil. */
  number?: string | null;
  amount: Money;
  vatAmount: Money;
  total: Money;
  issueDate: Iso;
  /** InvoiceStatus: TASLAK | GONDERILDI | KISMI_ODENDI | ODENDI | IPTAL | IADE */
  status: string;
  pdfKey?: string | null;
  createdAt?: Iso;
}

// ---------------------------------------------------------- Dört-göz onayı

export interface AdminApprovalRequest {
  id: string;
  /** PlatformUser.id — kendi talebini onaylama yasağı bununla belirlenir. */
  requestedBy: string;
  requestedByEmail?: string | null;
  requestedByName?: string | null;
  requestedByRole?: string | null;
  /** Serbest metin işlem anahtarı (ör. "tenant.suspend", "payment.refund"). */
  action: string;
  /** JSON string — özet üretmek için ayrıştırılır. */
  payloadJson?: string | null;
  payload?: unknown;
  tenantId?: string | null;
  tenantName?: string | null;
  /** ApprovalStatus: BEKLIYOR | ONAYLANDI | REDDEDILDI | SURESI_DOLDU */
  status: string;
  decidedBy?: string | null;
  decidedByEmail?: string | null;
  decidedAt?: Iso | null;
  decisionNote?: string | null;
  expiresAt: Iso;
  createdAt: Iso;
}

// ---------------------------------------------------------------- Sistem

export interface AdminSetting {
  id?: string;
  key: string;
  /** JSON string olarak saklanır. */
  valueJson: string;
  description?: string | null;
  updatedBy?: string | null;
  updatedByEmail?: string | null;
  updatedAt?: Iso | null;
}

export interface AdminFeatureFlag {
  id: string;
  key: string;
  description?: string | null;
  isEnabledGlobally: boolean;
  /** JSON string dizisi — ["tenantId", ...] */
  enabledTenantIdsJson?: string | null;
  enabledTenantIds?: string[] | null;
  updatedBy?: string | null;
  updatedByEmail?: string | null;
  updatedAt?: Iso | null;
}

export interface AdminAnnouncement {
  id: string;
  title: string;
  body: string;
  /** AnnouncementSeverity: BILGI | UYARI | KRITIK */
  severity: string;
  /** AnnouncementAudience: TUM | PLAN_BAZLI | TENANT_BAZLI */
  audience: string;
  targetJson?: string | null;
  publishedAt?: Iso | null;
  expiresAt?: Iso | null;
  createdBy?: string | null;
  createdByEmail?: string | null;
  createdAt?: Iso;
}

export interface AdminHealthCheck {
  key: string;
  label?: string | null;
  /** OK | DEGRADED | DOWN | UNKNOWN (veya up/down) */
  status: string;
  value?: string | null;
  detail?: string | null;
  checkedAt?: Iso | null;
}

export interface AdminHealthResponse {
  status?: string;
  uptimePct?: number | null;
  checkedAt?: Iso | null;
  checks?: AdminHealthCheck[];
  /** Nest terminus biçimi: { info: { db: { status: "up" } }, ... } */
  info?: Record<string, { status?: string } & Record<string, unknown>>;
  details?: Record<string, { status?: string } & Record<string, unknown>>;
  error?: Record<string, { status?: string } & Record<string, unknown>>;
}

// -------------------------------------------------------------- Metrikler

export interface AdminOverview {
  totalTenants?: number | null;
  activeTenants?: number | null;
  trialTenants?: number | null;
  suspendedTenants?: number | null;
  pastDueTenants?: number | null;
  canceledTenants?: number | null;
  newTenantsThisMonth?: number | null;

  mrr?: Money;
  arr?: Money;
  churnPct?: number | null;
  trialConversionPct?: number | null;
  totalSeats?: number | null;

  dau?: number | null;
  wau?: number | null;
  mau?: number | null;

  aiCallCount30d?: number | null;
  aiInputTokens30d?: number | null;
  aiOutputTokens30d?: number | null;
  storageBytes?: BytesValue;

  failedPayments?: number | null;
  pendingApprovals?: number | null;
  activeSupportGrants?: number | null;
  trialsEndingSoon?: number | null;
  uptimePct?: number | null;
}

/** GET /metrics/usage?from=&to= — UsageSnapshot serisi. */
export interface AdminUsagePoint {
  date: Iso;
  tenantId?: string | null;
  tenantName?: string | null;
  activeUsers?: number | null;
  caseCount?: number | null;
  documentCount?: number | null;
  aiCallCount?: number | null;
  aiInputTokens?: number | null;
  aiOutputTokens?: number | null;
  storageBytes?: BytesValue;
}

/** GET /metrics/ai?groupBy=tenant|taskType|provider|model */
export interface AdminAiMetricRow {
  /** Sunucu tek bir gruplama anahtarı döndürüyorsa. */
  key?: string | null;
  label?: string | null;

  tenantId?: string | null;
  tenantName?: string | null;
  taskType?: string | null;
  providerType?: string | null;
  model?: string | null;

  calls?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Sağlayıcı token bilgisi döndürmeyen çağrılar — SIFIR VARSAYILMAZ. */
  unknownTokenCalls?: number | null;
  errorCount?: number | null;
  errorRatePct?: number | null;
  piiMaskedCalls?: number | null;
  piiMaskedPct?: number | null;
  p95Ms?: number | null;
}

/** GET /metrics/investor — ANALYST_READONLY görünümü. Tenant kimliği İÇERMEZ. */
export interface AdminInvestorMetrics {
  mrr?: Money;
  arr?: Money;
  churnPct?: number | null;
  nrrPct?: number | null;
  payingTenants?: number | null;
  totalTenants?: number | null;
  newTenantsThisMonth?: number | null;
  trialConversionPct?: number | null;
  dau?: number | null;
  wau?: number | null;
  mau?: number | null;
  aiCallCount30d?: number | null;
  aiTokens30d?: number | null;
  uptimePct?: number | null;
  planDistribution?: Array<{ planKey: string; count: number; mrr?: Money }>;
  activationFunnel?: Array<{ step: string; label?: string | null; count: number }>;
  mrrSeries?: Array<{ month: string; mrr: Money; payingTenants?: number | null }>;
}

// --------------------------------------------------------- Destek erişimi

export interface AdminSupportGrant {
  id: string;
  tenantId: string;
  tenantName?: string | null;
  platformUserId: string;
  platformUserEmail?: string | null;
  platformUserName?: string | null;
  reason: string;
  /** SupportScope: SADECE_USTVERI | YAPILANDIRMA | ICERIK_MASKELI */
  scope: string;
  grantedAt: Iso;
  expiresAt: Iso;
  revokedAt?: Iso | null;
  revokedBy?: string | null;
}

// ------------------------------------------------------------- Denetim izi

export interface AdminAuditEntry {
  id: string;
  createdAt: Iso;
  platformUserId?: string | null;
  platformUserEmail?: string | null;
  platformUserName?: string | null;
  platformUserRole?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  detail?: string | null;
  ipAddress?: string | null;
}

// -------------------------------------------------------- Platform personeli

export interface AdminPlatformUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  /** twoFactorSecret ASLA dönmez; yalnız kurulu olup olmadığı bildirilir. */
  twoFactorEnabled?: boolean;
  lastLoginAt?: Iso | null;
  createdAt?: Iso;
  updatedAt?: Iso;
}

/** Yazma uçlarının dört-göz akışına düştüğünü bildiren ortak yanıt. */
export interface AdminMutationResult {
  approvalRequestId?: string;
  approvalRequest?: AdminApprovalRequest;
  status?: string;
  message?: string;
  requiresApproval?: boolean;
}
