/**
 * Panelin kullandığı GERÇEK uçlar — hepsi /api/admin/v1 önekiyle.
 * Yol sabitleri tek yerde tutulur ki sayfalar arasında sapma olmasın.
 *
 * Kaynak sözleşme (Platform ajanı bu uçları yazar):
 *   POST   /auth/login                     { email, password } → { accessToken, user } | { twoFactorRequired, challengeToken }
 *   POST   /auth/2fa/verify                { challengeToken, code } → { accessToken, user }
 *   GET    /auth/me
 *   GET    /tenants?q=&status=&plan=
 *   GET    /tenants/:id
 *   POST   /tenants/:id/suspend | /activate     (→ dört-göz onay talebi döner)
 *   POST   /tenants/:id/support-access
 *   GET    /subscriptions
 *   PATCH  /subscriptions/:id
 *   POST   /subscriptions/:id/cancel
 *   GET    /payments?status=   ·  GET /payments/failed  ·  POST /payments/:id/refund
 *   GET    /approvals?status=  ·  POST /approvals/:id/approve | /reject
 *   GET    /settings           ·  PUT /settings
 *   GET    /feature-flags      ·  POST /feature-flags  ·  PATCH /feature-flags/:id
 *   GET    /announcements      ·  POST /announcements  ·  PATCH|DELETE /announcements/:id
 *   GET    /health
 *   GET    /metrics/overview   ·  /metrics/usage?from=&to=  ·  /metrics/ai?groupBy=  ·  /metrics/investor
 *   GET    /support-access     ·  DELETE /support-access/:id
 *   GET    /audit
 *   GET    /platform-users     ·  POST /platform-users  ·  PATCH|DELETE /platform-users/:id
 *   GET    /credits/tenants    ·  GET /credits/tenants/:id  ·  PATCH /credits/tenants/:id (dört-göz)
 *   GET    /credits/costs      ·  PATCH /credits/costs
 *   GET    /credits/margin?from=&to=  ·  GET /credits/anomalies
 *   GET    /model-prices       ·  POST|PATCH /model-prices
 */

export const EP = {
  /** D5 / M4 — fine-tuning iş yönetimi (platform AI eğitim hattı). */
  fineTune: {
    list: "/fine-tune-jobs",
    create: "/fine-tune-jobs", // POST — iş açılır; sağlayıcıya OTOMATİK gönderim yok
    manifest: (id: string) => `/fine-tune-jobs/${encodeURIComponent(id)}/manifest`,
    status: (id: string) => `/fine-tune-jobs/${encodeURIComponent(id)}/status`,
    samples: "/ai-training/samples",
  },
  auth: {
    login: "/auth/login",
    /** 2FA ikinci adımı — { challengeToken, code } → { accessToken, user }. */
    verify2fa: "/auth/2fa/verify",
    /** 2FA kurulumu (kurulum zorunlu ama tamamlanmamışsa) — { challengeToken }. */
    setup2fa: "/auth/2fa/setup",
    me: "/auth/me",
  },
  tenants: {
    list: "/tenants",
    create: "/tenants", // POST — dört-göz TENANT_CREATE talebi (D5 / M2)
    detail: (id: string) => `/tenants/${encodeURIComponent(id)}`,
    /** Tenant AI sağlayıcı ÜSTVERİSİ (anahtar dönmez). */
    aiConfig: (id: string) => `/tenants/${encodeURIComponent(id)}/ai-config`,
    suspend: (id: string) => `/tenants/${encodeURIComponent(id)}/suspend`,
    activate: (id: string) => `/tenants/${encodeURIComponent(id)}/activate`,
    supportAccess: (id: string) => `/tenants/${encodeURIComponent(id)}/support-access`,
  },
  subscriptions: {
    list: "/subscriptions",
    update: (id: string) => `/subscriptions/${encodeURIComponent(id)}`,
    /** F2-Ö-36: durum geçişi AYRI uçta — POST /subscriptions/:id/transition. */
    transition: (id: string) => `/subscriptions/${encodeURIComponent(id)}/transition`,
    cancel: (id: string) => `/subscriptions/${encodeURIComponent(id)}/cancel`,
  },
  payments: {
    list: "/payments",
    failed: "/payments/failed",
    refund: (id: string) => `/payments/${encodeURIComponent(id)}/refund`,
  },
  approvals: {
    list: "/approvals",
    approve: (id: string) => `/approvals/${encodeURIComponent(id)}/approve`,
    reject: (id: string) => `/approvals/${encodeURIComponent(id)}/reject`,
  },
  settings: "/settings",
  /** F2-Ö-31: sunucu sözleşmesi PUT /settings/:key + { value, reason }. */
  settingsDetail: (key: string) => `/settings/${encodeURIComponent(key)}`,
  featureFlags: {
    list: "/feature-flags",
    create: "/feature-flags",
    update: (id: string) => `/feature-flags/${encodeURIComponent(id)}`,
  },
  announcements: {
    list: "/announcements",
    create: "/announcements",
    update: (id: string) => `/announcements/${encodeURIComponent(id)}`,
    remove: (id: string) => `/announcements/${encodeURIComponent(id)}`,
  },
  health: "/health",
  metrics: {
    overview: "/metrics/overview",
    usage: "/metrics/usage",
    ai: "/metrics/ai",
    investor: "/metrics/investor",
  },
  supportAccess: {
    list: "/support-access",
    revoke: (id: string) => `/support-access/${encodeURIComponent(id)}`,
  },
  /** F2-Ö-33: platform zamanlanmış işleri. */
  jobs: {
    list: "/jobs",
    runs: (key: string) => `/jobs/${encodeURIComponent(key)}/runs`,
    run: (key: string) => `/jobs/${encodeURIComponent(key)}/run`,
    /** Aç/kapat + cron değiştir — değişiklik kuyruğa anında yansır. */
    patch: (key: string) => `/jobs/${encodeURIComponent(key)}`,
  },
  audit: "/audit",
  /** Tanıtım sitesi demo talepleri — kayıt olarak izlenir (e-posta yok). */
  demoRequests: {
    list: "/demo-requests",
    detail: (id: string) => `/demo-requests/${id}`,
  },
  /** Modül 26 — AI kota ve kredi sistemi. */
  credits: {
    tenants: "/credits/tenants",
    tenantDetail: (id: string) => `/credits/tenants/${encodeURIComponent(id)}`,
    /** PATCH — dört-göz onay talebi üretir, işlemi UYGULAMAZ. */
    adjust: (id: string) => `/credits/tenants/${encodeURIComponent(id)}`,
    costs: "/credits/costs",
    margin: "/credits/margin",
    anomalies: "/credits/anomalies",
  },
  modelPrices: "/model-prices",
  platformUsers: {
    list: "/platform-users",
    create: "/platform-users",
    update: (id: string) => `/platform-users/${encodeURIComponent(id)}`,
    remove: (id: string) => `/platform-users/${encodeURIComponent(id)}`,
  },
  /** Yargı organları + noterler referans kataloğu. */
  judicial: {
    bodies: "/judicial/bodies",
    body: (id: string) => `/judicial/bodies/${encodeURIComponent(id)}`,
    notaries: "/judicial/notaries",
    notary: (id: string) => `/judicial/notaries/${encodeURIComponent(id)}`,
    /** D7 — vergi dairesi kataloğu (müvekkil kartında seçilen liste). */
    taxOffices: "/judicial/tax-offices",
    taxOffice: (id: string) => `/judicial/tax-offices/${encodeURIComponent(id)}`,
    syncSettings: "/judicial/sync/settings",
    syncNow: "/judicial/sync",
    syncLogs: "/judicial/sync/logs",
  },
  /** Platform AI sağlayıcıları (D1.3). */
  platformAi: {
    list: "/ai/providers",
    create: "/ai/providers",
    item: (id: string) => `/ai/providers/${encodeURIComponent(id)}`,
    test: (id: string) => `/ai/providers/${encodeURIComponent(id)}/test`,
    models: (id: string) => `/ai/providers/${encodeURIComponent(id)}/models`,
  },
  /** İçtihat havuz yönetimi (D1 — RAG havuzunu platform eliyle doldurma). */
  caseLawPool: {
    stats: "/caselaw-pool",
    records: "/caselaw-pool/records",
    import: "/caselaw-pool/import",
  },

  /** İçtihat toplama hattı — besleme kaynakları, onay kuyruğu, elle çekim. */
  caseLawIngest: {
    sources: "/caselaw-ingest/sources",
    upsertSource: "/caselaw-ingest/sources",
    items: "/caselaw-ingest/items",
    run: "/caselaw-ingest/run",
    approve: (id: string) => `/caselaw-ingest/items/${encodeURIComponent(id)}/approve`,
    reject: (id: string) => `/caselaw-ingest/items/${encodeURIComponent(id)}/reject`,
    /** Onay ÖNCESİ karar metni (Onay Masası okuma bölmesi) — fullText ya da canlı kaynak. */
    preview: (id: string) => `/caselaw-ingest/items/${encodeURIComponent(id)}/preview`,
  },

  /**
   * Mevzuat toplama hattı (hukuki veri kaynağı besleme planı, Faz 1+3) —
   * mevzuat.gov.tr tohumu, RG izleyici, KVKK/Rekabet izleyicileri → onay kuyruğu.
   * Onay tek kapıdan (LegislationPoolService) havuza yazar; panel havuza doğrudan yazmaz.
   */
  legislationIngest: {
    stats: "/legislation-ingest/stats",
    health: "/legislation-ingest/health",
    items: "/legislation-ingest/items",
    preview: (id: string) => `/legislation-ingest/items/${encodeURIComponent(id)}/preview`,
    approve: (id: string) => `/legislation-ingest/items/${encodeURIComponent(id)}/approve`,
    reject: (id: string) => `/legislation-ingest/items/${encodeURIComponent(id)}/reject`,
    run: (source: "tohum" | "rg" | "kvkk" | "rekabet") => `/legislation-ingest/run/${source}`,
  },
} as const;
