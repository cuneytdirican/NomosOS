/**
 * Panelin kullandığı GERÇEK uçlar — hepsi /api/admin/v1 önekiyle.
 * Yol sabitleri tek yerde tutulur ki sayfalar arasında sapma olmasın.
 *
 * Kaynak sözleşme (Platform ajanı bu uçları yazar):
 *   POST   /auth/login                     { email, password, totp? } → { token, user }
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
  auth: {
    login: "/auth/login",
    me: "/auth/me",
  },
  tenants: {
    list: "/tenants",
    detail: (id: string) => `/tenants/${encodeURIComponent(id)}`,
    suspend: (id: string) => `/tenants/${encodeURIComponent(id)}/suspend`,
    activate: (id: string) => `/tenants/${encodeURIComponent(id)}/activate`,
    supportAccess: (id: string) => `/tenants/${encodeURIComponent(id)}/support-access`,
  },
  subscriptions: {
    list: "/subscriptions",
    update: (id: string) => `/subscriptions/${encodeURIComponent(id)}`,
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
  audit: "/audit",
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
} as const;
