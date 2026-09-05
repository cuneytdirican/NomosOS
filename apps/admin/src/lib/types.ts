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
  /** Kurulum zorunlu ama tamamlanmamış — /auth/2fa/setup akışına yönlendirir. */
  twoFactorSetupRequired?: boolean;
  /** 2FA ikinci adımının anahtarı — /auth/2fa/verify girdisidir (F2-K-01). */
  challengeToken?: string;
  message?: string;
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

  /** GET /tenants yanıtında abonelik bu NESNE içinde gelir (tenantId @unique). */
  subscription?: {
    id: string;
    planKey?: string | null;
    status?: string | null;
    seats?: number | null;
    trialEndsAt?: Iso | null;
    currentPeriodStart?: Iso | null;
    currentPeriodEnd?: Iso | null;
  } | null;

  // Toplulaştırılmış sayaçlar (gerçek alan adları — API yanıtıyla hizalı)
  userCount?: number | null;
  clientCount?: number | null;
  caseCount?: number | null;
  documentCount?: number | null;
  aiCallCount30d?: number | null;
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

/** GET /tenants/:id — PlatformTenantsService.detail() gerçek yanıt şekli. */
export interface AdminTenantDetail {
  tenant: {
    id: string;
    name: string;
    aiPolicy?: string | null;
    autoMaskConsent?: boolean | null;
    createdAt?: Iso;
  };
  subscription?: {
    id: string;
    planKey?: string | null;
    status?: string | null;
    seats?: number | null;
    trialEndsAt?: Iso | null;
    currentPeriodStart?: Iso | null;
    currentPeriodEnd?: Iso | null;
    canceledAt?: Iso | null;
    note?: string | null;
  } | null;
  plan?: {
    key: string;
    name: string;
    monthlyPricePerUser?: Money;
    maxUsers?: number | null;
    isActive?: boolean;
  } | null;
  counters: {
    userCount?: number | null;
    clientCount?: number | null;
    caseCount?: number | null;
    documentCount?: number | null;
    aiCallCount30d?: number | null;
  };
  /** Son 30 günün UsageSnapshot'ları (tarihe göre azalan). */
  usage?: Array<{
    date: Iso;
    activeUsers?: number | null;
    caseCount?: number | null;
    documentCount?: number | null;
    aiCallCount?: number | null;
    aiInputTokens?: number | null;
    aiOutputTokens?: number | null;
    storageBytes?: number | null;
  }>;
  activeSupportGrants?: number | null;
  contentAccessNote?: string | null;
}

/** GET /tenants/:id/ai-config — sağlayıcı ÜSTVERİSİ (anahtar asla dönmez). */
export interface AdminAiConfig {
  items: Array<{
    id: string;
    name?: string | null;
    type: string;
    baseUrl?: string | null;
    defaultModel?: string | null;
    isActive?: boolean;
    hasApiKey?: boolean;
  }>;
  note?: string | null;
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
  uptimeSeconds?: number | null;
  checkedAt?: Iso | null;
  checks?: AdminHealthCheck[];
  /** PlatformHealthService biçimi: { components: [{ component, status, latencyMs, detail }] } */
  components?: Array<{
    component: string;
    status: string;
    latencyMs?: number | null;
    detail?: string | null;
  }>;
  /** Nest terminus biçimi: { info: { db: { status: "up" } }, ... } */
  info?: Record<string, { status?: string } & Record<string, unknown>>;
  details?: Record<string, { status?: string } & Record<string, unknown>>;
  error?: Record<string, { status?: string } & Record<string, unknown>>;
}

// -------------------------------------------------------------- Metrikler

export interface AdminOverview {
  /** GET /metrics/overview — PlatformMetricsService'in gerçek (iç içe) yanıt şekli */
  tenants?: {
    total?: number | null;
    newThisMonth?: number | null;
    active?: number | null;
    trial?: number | null;
    pastDue?: number | null;
    suspended?: number | null;
    canceled?: number | null;
    withoutSubscription?: number | null;
  } | null;
  revenue?: {
    mrr?: Money;
    arr?: Money;
    currency?: string | null;
    mrrUnknownSubscriptions?: number | null;
  } | null;
  attention?: {
    failedPayments?: number | null;
    trialEndingIn48h?: number | null;
  } | null;
  ai?: {
    windowDays?: number | null;
    callCount?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    note?: string | null;
  } | null;
  /** Sunucu bu alanları overview'da dönmüyorsa kartlar dürüstçe "—" gösterir. */
  churnPct?: number | null;
  trialConversionPct?: number | null;
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
  /** F2-Ö-32: sunucu platformUser'ı iç içe döndürür (post-FK-kaldırma deseni). */
  platformUser?: {
    id: string;
    fullName: string;
    email: string;
    role: string;
  } | null;
  /** @deprecated Eski düz alanlar — silinmiş kullanıcılar için artık gelmez. */
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

// -------------------------------------------------- Modül 26: kredi sistemi

export type AdminBillingMode = "YONETILEN" | "BYO_LLM" | "SINIRSIZ";

/** GET /credits/tenants — tenant başına kota ve tüketim. */
export interface AdminCreditTenantRow {
  /** ANALYST/maskeli görünümde null döner. */
  tenantId: string | null;
  tenantAdi: string;
  mod: AdminBillingMode;
  plan: string | null;
  koltuk: number | null;
  abonelikDurumu: string | null;
  donemBaslangic: Iso;
  donemBitis: Iso;
  dahilKota: number;
  dahilTuketilen: number;
  satinAlinan: number;
  rezerve: number;
  kullanilabilir: number;
  kullanimYuzdesi: number;
  belgeKotasi: number;
  belgeKullanilan: number;
  otomatikYukleme: string | null;
  toplamTuketilenKredi: number;
  tuketimHareketi: number;
}

/** GET /credits/costs — görev başına kredi fiyatı (AiTaskCost). */
export interface AdminTaskCost {
  id: string;
  taskType: string;
  credits: number;
  isFree: boolean;
  description?: string | null;
  updatedBy?: string | null;
  updatedAt?: Iso;
}

/** GET /model-prices — İÇ MALİYET tablosu, kullanıcıya gösterilmez. */
export interface AdminModelPrice {
  id: string;
  providerType: string;
  model: string;
  inputPricePer1M: string;
  outputPricePer1M: string;
  currency: string;
  effectiveFrom: Iso;
  /** Bugün yürürlükte olan satır mı? (aynı model için birden çok satır olabilir) */
  yururlukte: boolean;
}

/** GET /credits/margin — maliyet / gelir / marj (iç muhasebe). */
export interface AdminMarginRow {
  tenantId: string | null;
  tenantAdi: string;
  mod: AdminBillingMode;
  cagri: number;
  /** Token bilgisi dönmediği için fiyatlanamayan çağrılar — SIFIR SAYILMAZ. */
  fiyatlanamayanCagri: number;
  girdiToken: number;
  ciktiToken: number;
  maliyetUsd: string;
  maliyetTl: string | null;
  tahsilEdilenKredi: number;
  gelirTl: string | null;
  marjTl: string | null;
  marjYuzde: string | null;
}

export interface AdminMarginReport {
  donem: { from: Iso; to: Iso };
  maskeli: boolean;
  parametreler: {
    krediBirimFiyati: string | null;
    paraBirimi: string;
    usdTryKuru: string | null;
    kaynak: string;
  };
  /** Kur ve birim fiyat tanımlı değilse false — marj UYDURULMAZ. */
  marjHesaplanabilir: boolean;
  marjUyarisi: string | null;
  toplam: {
    maliyetUsd: string;
    tahsilEdilenKredi: number;
    gelirTl: string | null;
    marjTl: string | null;
  };
  items: AdminMarginRow[];
  not: string;
}

/** GET /credits/anomalies — anormal tüketim UYARISI (kesme değil). */
export interface AdminCreditAnomaly {
  tenantId: string;
  sonSaat: number;
  saatlikOrtalama: number;
  kat: number | null;
}

/** Faz 3 — kupon. */
export interface AdminCoupon {
  id: string;
  code: string;
  kind: "YUZDE" | "SABIT";
  value: string;
  appliesTo: "TUM" | "ABONELIK" | "KREDI";
  validFrom: Iso | null;
  validUntil: Iso | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  isActive: boolean;
  note: string | null;
  createdAt: Iso;
  label: string;
}
