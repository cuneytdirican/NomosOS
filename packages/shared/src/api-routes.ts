/**
 * KİRACI API UÇ TABLOSU — İSTEMCİ VE SUNUCU İÇİN TEK KAYNAK.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NEDEN VAR: Faz 3 denetiminde `apps/web` katmanının SEKİZ ucu API'de     ║
 * ║ olmayan adreslere çağırdığı bulundu (denetim bulgusu 12). Fatura        ║
 * ║ detayındaki "Kesinleştir" ve "Ödeme kaydet" düğmeleri 404 alıyordu;     ║
 * ║ mali açıdan en riskli olanı, TAHSİLAT KAYDININ ARAYÜZDEN HİÇ            ║
 * ║ YAZILAMAMASIYDI — muhasebe ödeme girdiğini sanıp giremiyordu.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Uç adları elle iki yerde yazıldığı sürece bu sınıf hata tekrar üretilir.
 * Tablo burada, ortak pakette durur; istemci yolları buradan TÜRETİR.
 *
 * SÖZLEŞME: yollar `/api/v1` ÖNEKİ OLMADAN yazılır — önek istemcinin `api()`
 * yardımcısında, sunucunun ise `setGlobalPrefix` ayarındadır.
 */

export const BILLING_ROUTES = {
  feeAgreements: "/billing/fee-agreements",
  feeAgreement: (id: string) => `/billing/fee-agreements/${id}`,

  timeEntries: "/billing/time-entries",
  timeEntry: (id: string) => `/billing/time-entries/${id}`,
  timeEntrySummary: "/billing/time-entries/summary",

  invoices: "/billing/invoices",
  invoice: (id: string) => `/billing/invoices/${id}`,
  /** Zaman kayıtlarından taslak fatura üretimi (satırları SUNUCU kurar). */
  invoicesFromTimeEntries: "/billing/invoices/from-time-entries",
  /** Kesinleştirme. İstemci bir dönem `/approve` çağırıyordu — uç yok. */
  invoiceFinalize: (id: string) => `/billing/invoices/${id}/finalize`,
  invoiceCancel: (id: string) => `/billing/invoices/${id}/cancel`,
  /** e-Fatura gönderimi. İstemci bir dönem `/send` çağırıyordu — uç yok. */
  invoiceSendEInvoice: (id: string) => `/billing/invoices/${id}/e-invoice/send`,
  /**
   * İ-32: BEKLIYOR mutabakat yolu — gönderim zaman aşımında takılan belgeyi
   * GİB'ten dönen gerçek durumla uzlaştırır (çift gönderim YOK).
   */
  invoiceEInvoiceStatus: (id: string) => `/billing/invoices/${id}/e-invoice/status`,
  /** A6 (rakip analizi): e-SMM (Serbest Meslek Makbuzu) gönderimi. */
  invoiceSendESmm: (id: string) => `/billing/invoices/${id}/e-smm/send`,

  /**
   * TAHSİLAT KAYDI FATURA ALTINDA DEĞİL, KENDİ UCUNDADIR ve gövdesinde
   * `clientId` + `invoiceId` taşır (tahsilat faturasız da kaydedilebilir).
   */
  payments: "/billing/payments",
  payment: (id: string) => `/billing/payments/${id}`,

  eInvoiceProvider: "/billing/e-invoice/provider",
  /** Faz 3: tenant başına entegratör ayarı + fatura PDF dökümü. */
  eInvoiceSettings: "/billing/e-invoice/settings",
  invoicePdf: (id: string) => `/billing/invoices/${id}/pdf`,
  taxpayerCheck: "/billing/taxpayer-check",
} as const;

export const FINANCE_ROUTES = {
  /** Büro geneli özet. İstemci bir dönem `/finance/reports/office` çağırıyordu. */
  summary: "/finance/summary",
  clientSummary: (clientId: string) => `/finance/clients/${clientId}/summary`,
  caseSummary: (caseId: string) => `/finance/cases/${caseId}/summary`,
  ask: "/finance/ask",
  entries: "/finance/entries",
  entry: (id: string) => `/finance/entries/${id}`,
} as const;

export const ENFORCEMENT_ROUTES = {
  list: "/enforcement",
  detail: (id: string) => `/enforcement/${id}`,
  stage: (id: string) => `/enforcement/${id}/stage`,
  actions: (id: string) => `/enforcement/${id}/actions`,
  /** Tekil işlem kaydı — dosyadan BAĞIMSIZ adreslenir. */
  action: (actionId: string) => `/enforcement-actions/${actionId}`,
  assets: (id: string) => `/enforcement/${id}/assets`,
  /** Tekil malvarlığı kaydı — dosyadan BAĞIMSIZ adreslenir (`/assets/:id`). */
  asset: (assetId: string) => `/assets/${assetId}`,
  collections: (id: string) => `/enforcement/${id}/collections`,
  balance: (id: string) => `/enforcement/${id}/balance`,
  deadlines: (id: string) => `/enforcement/${id}/deadlines`,
  suggestDeadlines: (id: string) => `/enforcement/${id}/deadlines/suggest`,
  score: (id: string) => `/enforcement/${id}/score`,
  /**
   * Skor YENİDEN HESABI ayrı bir uç DEĞİLDİR: copilot'un
   * `TAHSILAT_IHTIMALI` komutu skoru üretir ve kaydeder.
   */
  copilot: (id: string) => `/enforcement/${id}/copilot`,
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * İ-27 — KALAN MODÜLLER. Katalog bir zamanlar yalnız üç modülü kapsıyordu;
 * "arayüz var olmayan uçlara çağrı yapıyor" hata sınıfının kök nedeni buydu.
 * Aşağıdaki bloklar gerçek controller'lardan mekanik olarak türetilmiştir ve
 * `apps/api/src/common/api-route-catalog.test.ts` sözleşme testiyle
 * controller'lara karşı sürekli doğrulanır: katalogdaki bir yol bir
 * controller'dan silinirse test KIRMIZIYA döner.
 * ══════════════════════════════════════════════════════════════════════════ */

export const AUTH_ROUTES = {
  login: "/auth/login",
  me: "/me",
  /** Sunucu tarafı çıkış — oturum damgası tüm cihazları düşürür (Ö-34). */
  logout: "/auth/logout",
  changePassword: "/auth/change-password",
  /** Faz 2: büro kullanıcısı parola sıfırlama (e-posta bağlantısı). */
  forgotPassword: "/auth/forgot-password",
  resetPassword: "/auth/reset-password",
  /** Enterprise++ 2FA (TOTP): ikinci adım / kurulum / kapatma. */
  twoFactorVerify: "/auth/2fa/verify",
  twoFactorSetup: "/auth/2fa/setup",
  twoFactorSetupWithChallenge: "/auth/2fa/setup-with-challenge",
  twoFactorDisable: "/auth/2fa/disable",
  /** Enterprise++ SSO (OIDC): başlat / IdP geri dönüşü. */
  ssoStart: "/auth/sso/start",
  ssoCallback: "/auth/sso/callback",
  /** Enterprise++: cihaz bazlı oturum listesi (GET) / diğerlerini kapat (DELETE). */
  sessions: "/auth/sessions",
  session: (id: string) => `/auth/sessions/${id}`,
} as const;

/** Enterprise++: API anahtarları + webhook'lar. */
export const INTEGRATION_ROUTES = {
  events: "/integrations/events",
  apiKeys: "/integrations/api-keys",
  apiKey: (id: string) => `/integrations/api-keys/${id}`,
  webhooks: "/integrations/webhooks",
  webhook: (id: string) => `/integrations/webhooks/${id}`,
  webhookTest: (id: string) => `/integrations/webhooks/${id}/test`,
  webhookDeliveries: (id: string) => `/integrations/webhooks/${id}/deliveries`,
} as const;

/** Enterprise++: büro güvenlik politikası + denetim izi. */
export const SECURITY_ROUTES = {
  policy: "/security/policy",
  audit: "/security/audit",
  auditActions: "/security/audit/actions",
  auditExportCsv: "/security/audit/export.csv",
  /** KVKK saklama/imha + veri öznesi talepleri. */
  kvkkRetention: "/security/kvkk/retention",
  kvkkAnonymize: (caseId: string) => `/security/kvkk/retention/cases/${caseId}/anonymize`,
  kvkkRequests: "/security/kvkk/requests",
  kvkkRespond: (id: string) => `/security/kvkk/requests/${id}/respond`,
  /** Enterprise++ SSO yapılandırması (GET/PUT) + discovery testi. */
  sso: "/security/sso",
  ssoTest: "/security/sso/test",
} as const;

export const USERS_ROUTES = {
  list: "/users",
  manage: "/users/manage",
  create: "/users",
  detail: (id: string) => `/users/${id}`,
  resetPassword: (id: string) => `/users/${id}/reset-password`,
  revokeSessions: (id: string) => `/users/${id}/revoke-sessions`,
  /** Enterprise++: kullanıcının cihaz oturumları (yönetici). */
  sessions: (id: string) => `/users/${id}/sessions`,
  session: (id: string, sid: string) => `/users/${id}/sessions/${sid}`,
  unlock: (id: string) => `/users/${id}/unlock`,
  /** Enterprise++: yönetici 2FA sıfırlaması (cihaz kaybı). */
  resetTwoFactor: (id: string) => `/users/${id}/reset-2fa`,
} as const;

export const CLIENTS_ROUTES = {
  list: "/clients",
  create: "/clients",
  detail: (id: string) => `/clients/${id}`,
  tckn: (id: string) => `/clients/${id}/tckn`,
  /** KVKK m.11 — müvekkil bazlı tam dışa aktarma (F2 · A1). */
  export: (id: string) => `/clients/${id}/export`,
  contacts: (id: string) => `/clients/${id}/contacts`,
  contact: (id: string, contactId: string) => `/clients/${id}/contacts/${contactId}`,
  /** D6-B — mükerrer tespiti (kaydı engellemez; uyarı). */
  duplicateCheck: "/clients/duplicate-check",
  /** D6 — mükerrer birleştirme öngörüsü (taşınacak kayıt sayıları).
   *  Çağıran `?source=<sourceId>` sorgu parametresini ekler. */
  mergePreview: (id: string) => `/clients/${id}/merge-preview`,
  /** D6 — mükerrer birleştirme (geri alınamaz; ADMIN/PARTNER). */
  merge: (id: string) => `/clients/${id}/merge`,
} as const;

export const CASES_ROUTES = {
  /** Enterprise++ gizli dosya erişim listesi. */
  members: (id: string) => `/cases/${id}/members`,
  list: "/cases",
  create: "/cases",
  detail: (id: string) => `/cases/${id}`,
  status: (id: string) => `/cases/${id}/status`,
  timeline: (id: string) => `/cases/${id}/timeline`,
  notes: (id: string) => `/cases/${id}/notes`,
  decisions: (id: string) => `/cases/${id}/decisions`,
  parties: (id: string) => `/cases/${id}/parties`,
  /** Dosyaya bağlı içtihat kayıtları (Faz 2 Modül 23). */
  caselaw: (caseId: string) => `/cases/${caseId}/caselaw`,
  petitions: (caseId: string) => `/cases/${caseId}/petitions`,
  poaStatus: (caseId: string) => `/cases/${caseId}/poa-status`,
  /** Not güncelleme/silme dosyadan BAĞIMSIZ adreslenir: /notes/:id */
  note: (id: string) => `/notes/${id}`,
} as const;

/** Vekaletname yönetimi (Modül 12) — azil ve kapsam analizi dahil. */
export const POA_ROUTES = {
  list: "/power-of-attorney",
  create: "/power-of-attorney",
  detail: (id: string) => `/power-of-attorney/${id}`,
  revoke: (id: string) => `/power-of-attorney/${id}/revoke`,
  scopeCheck: (id: string) => `/power-of-attorney/${id}/scope-check`,
  scopeChecks: (id: string) => `/power-of-attorney/${id}/scope-checks`,
  scopeCatalog: "/power-of-attorney/scope-catalog",
  warnings: "/power-of-attorney/warnings",
} as const;

export const DEADLINE_RULES_ROUTES = {
  list: "/deadline-rules",
} as const;

export const DEADLINES_ROUTES = {
  list: "/deadlines",
  upcoming: "/deadlines/upcoming",
  create: "/deadlines",
  /** Serbest hesaplama (tebliğ + yöntem + gün). */
  compute: "/deadlines/compute",
  /** Kural motorundan süre üretimi. */
  fromRule: "/deadlines/from-rule",
  detail: (id: string) => `/deadlines/${id}`,
  /** K-14: motorun ürettiği sürenin GİRDİSİNİN düzeltilmesi. */
  inputs: (id: string) => `/deadlines/${id}/inputs`,
  status: (id: string) => `/deadlines/${id}/status`,
} as const;

export const HEARINGS_ROUTES = {
  list: "/hearings",
  create: "/hearings",
  detail: (id: string) => `/hearings/${id}`,
  result: (id: string) => `/hearings/${id}/result`,
  /** Faz 1: sonucu girilmemiş duruşmalar + HEARING_PREP hazırlık paketi. */
  pendingResults: "/hearings/pending-results",
  prep: (id: string) => `/hearings/${id}/prep`,
} as const;

export const TASKS_ROUTES = {
  list: "/tasks",
  create: "/tasks",
  detail: (id: string) => `/tasks/${id}`,
  status: (id: string) => `/tasks/${id}/status`,
} as const;

export const DOCUMENTS_ROUTES = {
  list: "/documents",
  create: "/documents",
  detail: (id: string) => `/documents/${id}`,
  text: (id: string) => `/documents/${id}/text`,
  download: (id: string) => `/documents/${id}/download`,
  reprocess: (id: string) => `/documents/${id}/reprocess`,
} as const;

/** Belge → otomatik aksiyon hattının öneri kuyruğu (Modül 06). */
export const PROPOSALS_ROUTES = {
  list: "/proposals",
  detail: (id: string) => `/proposals/${id}`,
  approve: (id: string) => `/proposals/${id}/approve`,
  reject: (id: string) => `/proposals/${id}/reject`,
} as const;

export const AI_ROUTES = {
  policy: "/ai/policy",
  providers: "/ai/providers",
  providerTest: (id: string) => `/ai/providers/${id}/test`,
  taskRoutes: "/ai/task-routes",
  chat: "/ai/chat",
  /** F2 · E1 — ajan koşusu iz görünümü. */
  agentRuns: "/ai/agent-runs",
} as const;

export const ASSISTANT_ROUTES = {
  index: (caseId: string) => `/assistant/index/${caseId}`,
  chat: "/assistant/chat",
  sessions: "/assistant/sessions",
  session: (id: string) => `/assistant/sessions/${id}`,
  analyze: (caseId: string) => `/assistant/analyze/${caseId}`,
  analyses: (caseId: string) => `/assistant/analyses/${caseId}`,
  notes: "/assistant/notes",
  noteApprove: (id: string) => `/assistant/notes/${id}/approve`,
  note: (id: string) => `/assistant/notes/${id}`,
  officeQuery: "/assistant/office-query",
} as const;

export const CASELAW_ROUTES = {
  search: "/caselaw/search",
  adapters: "/caselaw/adapters",
  verify: "/caselaw/verify",
  aiSearch: "/caselaw/ai-search",
  create: "/caselaw",
  detail: (id: string) => `/caselaw/${id}`,
  summarize: (id: string) => `/caselaw/${id}/summarize`,
  /** Dosyaya bağlanmış içtihat referansı — tekil güncelleme. */
  reference: (id: string) => `/caselaw-references/${id}`,
} as const;

/** Not: dilekçe ŞABLONLARI `/petition-templates` altındadır (yalnız liste);
 * üretilen dilekçeler `/petitions`, dosyaya bağlılar `/cases/:caseId/petitions`. */
export const PETITION_ROUTES = {
  templates: "/petition-templates",
  create: "/petitions",
  /** Dilekçe Stüdyosu — büro geneli liste (dosya/durum/ürün süzgeçli). */
  list: "/petitions",
  detail: (id: string) => `/petitions/${id}`,
  status: (id: string) => `/petitions/${id}/status`,
  verify: (id: string) => `/petitions/${id}/verify`,
  generate: (id: string) => `/petitions/${id}/generate`,
  versions: (id: string) => `/petitions/${id}/versions`,
  rewriteSection: (id: string, key: string) => `/petitions/${id}/sections/${key}/rewrite`,
  exportUdf: (id: string) => `/petitions/${id}/export/udf`,
} as const;

export const CONFLICT_ROUTES = {
  /** Tarama BAŞLATMA fiili tekil kaynaklıdır: POST /conflict-check. */
  check: "/conflict-check",
  decide: (id: string) => `/conflict-check/${id}/decide`,
  list: "/conflict-checks",
  pendingWarnings: "/conflict-checks/pending/warnings",
  detail: (id: string) => `/conflict-checks/${id}`,
} as const;

/** Delil matrisi — çoğu uç dosya kapsamındadır (/cases/:caseId/...). */
export const EVIDENCE_ROUTES = {
  claims: (caseId: string) => `/cases/${caseId}/claims`,
  evidence: (caseId: string) => `/cases/${caseId}/evidence`,
  matrix: (caseId: string) => `/cases/${caseId}/evidence-matrix`,
  aiMatrix: (caseId: string) => `/cases/${caseId}/evidence/ai-matrix`,
  gapAnalysis: (caseId: string) => `/cases/${caseId}/evidence/gap-analysis`,
  claim: (id: string) => `/claims/${id}`,
  claimEvidence: (id: string, evidenceId: string) => `/claims/${id}/evidence/${evidenceId}`,
  legalBasis: (id: string) => `/claims/${id}/legal-basis`,
  legalBasisItem: (id: string, basisId: string) => `/claims/${id}/legal-basis/${basisId}`,
  evidenceItem: (id: string) => `/evidence/${id}`,
} as const;

export const EXPERT_ROUTES = {
  experts: "/experts",
  expert: (id: string) => `/experts/${id}`,
  reports: (caseId: string) => `/cases/${caseId}/expert-reports`,
  reportDiffs: (caseId: string) => `/cases/${caseId}/expert-report-diffs`,
  compare: "/expert-reports/compare",
  report: (id: string) => `/expert-reports/${id}`,
  objection: (id: string) => `/expert-reports/${id}/objection`,
  objectionDraft: (id: string) => `/expert-reports/${id}/objection/draft-petition`,
  objectionItem: (id: string) => `/expert-objections/${id}`,
  objectionDraftPetition: (id: string) => `/expert-objections/${id}/draft-petition`,
} as const;

export const SIMULATION_ROUTES = {
  modes: "/simulations/modes",
  compare: "/simulations/compare",
  list: "/simulations",
  detail: (id: string) => `/simulations/${id}`,
  simulate: (caseId: string) => `/cases/${caseId}/simulate`,
  caseSimulations: (caseId: string) => `/cases/${caseId}/simulations`,
} as const;

export const STRATEGY_ROUTES = {
  strategy: (caseId: string) => `/cases/${caseId}/strategy`,
  detail: (id: string) => `/strategy/${id}`,
  status: (id: string) => `/strategy/${id}/status`,
  versions: (id: string) => `/strategy/${id}/versions`,
  build: (id: string) => `/strategy/${id}/build`,
  nodes: (id: string) => `/strategy/${id}/nodes`,
  node: (id: string, nodeId: string) => `/strategy/${id}/nodes/${nodeId}`,
  version: (id: string) => `/strategy-versions/${id}`,
} as const;

export const RISK_ROUTES = {
  caseRisk: (caseId: string) => `/cases/${caseId}/risk`,
  compute: (caseId: string) => `/cases/${caseId}/risk/compute`,
  history: (caseId: string) => `/cases/${caseId}/risk/history`,
  override: (caseId: string) => `/cases/${caseId}/risk/override`,
  overrideDimension: (caseId: string, dimension: string) =>
    `/cases/${caseId}/risk/override/${dimension}`,
  office: "/risk/office",
} as const;

/** İletişim merkezi — dört ayrı kaynak, tek modül (Modül 19). */
export const COMMUNICATION_ROUTES = {
  timeline: "/communications/timeline",
  channels: "/communications/channels",
  unanswered: "/communications/unanswered",
  list: "/communications",
  detail: (id: string) => `/communications/${id}`,
  create: "/communications",
  /** Giden mesajlar — onay/red/gönderim uçlarıyla (Ö-33). */
  outbound: "/outbound-messages",
  outboundApprovals: "/outbound-messages/approvals",
  outboundDetail: (id: string) => `/outbound-messages/${id}`,
  outboundSubmit: (id: string) => `/outbound-messages/${id}/submit`,
  outboundApprove: (id: string) => `/outbound-messages/${id}/approve`,
  outboundReject: (id: string) => `/outbound-messages/${id}/reject`,
  outboundSend: (id: string) => `/outbound-messages/${id}/send`,
  /** Gelen mesajlar — dosyaya eşleştirme dahil. */
  inbound: "/inbound-messages",
  inboundDetail: (id: string) => `/inbound-messages/${id}`,
  inboundSuggestCase: (id: string) => `/inbound-messages/${id}/suggest-case`,
  inboundMatch: (id: string) => `/inbound-messages/${id}/match`,
  /** Şablonlar. */
  templates: "/message-templates",
  template: (id: string) => `/message-templates/${id}`,
  templateCopy: (id: string) => `/message-templates/${id}/copy`,
  templateRender: (id: string) => `/message-templates/${id}/render`,
} as const;

/** Sözleşme yaşam döngüsü + e-imza (Modül 20). */
export const CONTRACT_ROUTES = {
  renewals: "/contracts/renewals",
  list: "/contracts",
  create: "/contracts",
  detail: (id: string) => `/contracts/${id}`,
  transition: (id: string) => `/contracts/${id}/transition`,
  versions: (id: string) => `/contracts/${id}/versions`,
  version: (id: string) => `/contract-versions/${id}`,
  review: (id: string) => `/contracts/${id}/review`,
  signatureRequests: (id: string) => `/contracts/${id}/signature-requests`,
  createSignatureRequest: (id: string) => `/contracts/${id}/signature-requests`,
  signatureRequestStatus: (id: string) => `/signature-requests/${id}/status`,
  cancelSignatureRequest: (id: string) => `/signature-requests/${id}/cancel`,
  signatureProviders: "/signature-providers/health",
} as const;

/** Büro tarafının portal yayın yönetimi (Modül 10/19). */
export const PORTAL_ADMIN_ROUTES = {
  users: "/portal-admin/users",
  invite: "/portal-admin/invite",
  deactivate: (id: string) => `/portal-admin/users/${id}/deactivate`,
  activate: (id: string) => `/portal-admin/users/${id}/activate`,
  publications: "/portal-admin/publications",
  bulkPublications: "/portal-admin/publications/bulk",
  publication: (id: string) => `/portal-admin/publications/${id}`,
  publishable: "/portal-admin/publishable",
  audit: "/portal-admin/audit",
} as const;

export const REPORT_ROUTES = {
  catalog: "/reports/catalog",
  runs: "/reports/runs",
  saved: "/reports/saved",
  createSaved: "/reports/saved",
  savedDetail: (id: string) => `/reports/saved/${id}`,
  runSaved: (id: string) => `/reports/saved/${id}/run`,
  run: (key: string) => `/reports/${key}`,
  export: (key: string) => `/reports/${key}/export`,
  interpret: (key: string) => `/reports/${key}/interpret`,
} as const;

export const CREDIT_ROUTES = {
  wallet: "/credits/wallet",
  transactions: "/credits/transactions",
  usage: "/credits/usage",
  costs: "/credits/costs",
  estimate: "/credits/estimate",
  packages: "/credits/packages",
  purchase: "/credits/purchase",
  autoTopup: "/credits/auto-topup",
  reconcile: "/credits/reconcile",
} as const;

export const NOTIFICATION_ROUTES = {
  list: "/notifications",
  unreadCount: "/notifications/unread-count",
  readAll: "/notifications/read-all",
  read: (id: string) => `/notifications/${id}/read`,
  /** Enterprise++: bildirim tercihleri (tür × kanal). */
  preferences: "/notifications/preferences",
  /** Faz 2: kiracıya ulaşan platform duyuruları (web şeridi). */
  announcements: "/notifications/announcements",
} as const;

/** Faz 3 — gelir hattı: abonelik, platform faturaları, ödeme. */
export const SUBSCRIPTION_ROUTES = {
  summary: "/subscription",
  invoices: "/subscription/invoices",
  pay: (id: string) => `/subscription/invoices/${id}/pay`,
  pdf: (id: string) => `/subscription/invoices/${id}/pdf`,
  coupon: "/subscription/coupon",
  interval: "/subscription/interval",
  /** Sağlayıcı geri dönüşleri (public). */
  paymentCallback: "/billing/odeme/callback",
  paymentWebhook: "/billing/odeme/webhook",
} as const;

/** Mobil cihaz push token'ları (Faz 6). */
export const DEVICE_TOKEN_ROUTES = {
  list: "/device-tokens",
  create: "/device-tokens",
  remove: (token: string) => `/device-tokens/${token}`,
} as const;

export const DASHBOARD_ROUTES = {
  summary: "/dashboard/summary",
} as const;

export const HEALTH_ROUTES = {
  root: "/health",
  /** Faz 4: readiness (DB/Redis/S3 gerçek yoklama; biri düşükse 503). */
  ready: "/health/ready",
  live: "/health/live",
};

/** Demo talebi (tanıtım sitesi formu → platform paneli izler; e-posta yok). */
export const DEMO_TALEP_ROUTES = {
  create: "/demo-talepleri",
};

/** AAÜT vekalet ücreti hesabı (D7 — tarife büro tarafından girilir). */
export const VEKALET_UCRETI_ROUTES = {
  hesapla: "/vekalet-ucreti/hesapla",
  tarife: (yil: string | number) => `/vekalet-ucreti/tarife/${yil}`,
  tarifeKaydet: "/vekalet-ucreti/tarife",
} as const;

/** Randevu ajandası (E9 — büro tarafı). */
export const RANDEVU_ROUTES = {
  list: "/randevular",
  create: "/randevular",
  detail: (id: string) => `/randevular/${id}`,
} as const;

/** Büro içi mesajlaşma (WhatsApp tarzı — SİLME UCU YOKTUR). */
export const CHAT_ROUTES = {
  contacts: "/chat/contacts",
  threads: "/chat/threads",
  messages: "/chat/messages",
  messagePresign: "/chat/messages/presign",
  read: "/chat/read",
  heartbeat: "/chat/heartbeat",
  typing: "/chat/typing",
  avatarPresign: "/chat/avatar/presign",
  avatarSet: "/chat/avatar",
  userAvatar: (id: string) => `/chat/users/${id}/avatar`,
  iceServers: "/chat/ice-servers",
  startCall: "/chat/calls",
  incomingCalls: "/chat/calls/incoming",
  call: (id: string) => `/chat/calls/${id}`,
  callAccept: (id: string) => `/chat/calls/${id}/accept`,
  callReject: (id: string) => `/chat/calls/${id}/reject`,
  callEnd: (id: string) => `/chat/calls/${id}/end`,
  callSignals: (id: string) => `/chat/calls/${id}/signals`,
} as const;

/** Disk kotası — plan dahili + satın alınan ek paketler. */
export const DISK_QUOTA_ROUTES = {
  status: "/disk-quota",
  packages: "/disk-quota/packages",
  purchase: "/disk-quota/purchase",
} as const;

/** UYAP Köprüsü — eklenti uçları (extension token) + web yönetim uçları. */
export const UYAP_ROUTES = {
  pair: "/uyap/pair",
  pairRefresh: "/uyap/pair/refresh",
  syncFiles: "/uyap/sync/files",
  syncEvents: "/uyap/sync/events",
  presign: "/uyap/documents/presign",
  commit: "/uyap/documents/commit",
  status: "/uyap/status",
  // Web (büro) tarafı
  pairingCode: "/uyap/pairing-code",
  devices: "/uyap/devices",
  deviceRevoke: (id: string) => `/uyap/devices/${id}/revoke`,
  matchQueue: "/uyap/match-queue",
  matchResolve: (id: string) => `/uyap/match-queue/${id}/resolve`,
} as const;

/** Yargı organları + noterler — referans katalog (formlarda seçim listesi). */
export const JUDICIAL_ROUTES = {
  iller: "/judicial/iller",
  bodies: "/judicial/bodies",
  notaries: "/judicial/notaries",
} as const;

/** Birleşik ajanda — dört kaynak tek takvimde. */
export const AGENDA_ROUTES = {
  list: "/agenda",
  /** Faz 1: ICS takvim aboneliği (token üret / beslemeyi çek). */
  feedToken: "/agenda/feed-token",
  feedIcs: "/agenda/feed.ics",
} as const;

/** Dosya giderleri (İİK m.202 kapatma hesabı dâhil). */
export const CASE_EXPENSE_ROUTES = {
  list: "/case-expenses",
  caseExpenses: (caseId: string) => `/cases/${caseId}/case-expenses`,
  closing: (caseId: string) => `/cases/${caseId}/case-expenses/closing`,
  markPaid: (id: string) => `/case-expenses/${id}/mark-paid`,
} as const;

/** Arabuluculuk süreçleri (6325 s.K.). */
export const MEDIATION_ROUTES = {
  list: "/mediations",
  create: "/mediations",
  detail: (id: string) => `/mediations/${id}`,
  transition: (id: string) => `/mediations/${id}/transition`,
} as const;

/** AI eğitim verisi (opt-in kiracı; maskeli örnekler). */
export const AI_TRAINING_ROUTES = {
  summary: "/ai-training/summary",
  optIn: "/ai-training/opt-in",
  samples: "/ai-training/samples",
} as const;

/** Mevzuat kütüphanesi (büronun kendi yüklediği metinler; RG senkronu YOK). */
export const LEGISLATION_ROUTES = {
  list: "/legislation",
  create: "/legislation",
  detail: (id: string) => `/legislation/${id}`,
  update: (id: string) => `/legislation/${id}`,
  remove: (id: string) => `/legislation/${id}`,
} as const;

/** HEPO (Modül 28) — İSG/Çevre/Sağlık uyum hukuku: katalog + müvekkil takibi. */
export const HEPO_ROUTES = {
  obligations: "/hepo/obligations",
  clientObligations: (clientId: string) => `/hepo/clients/${clientId}/obligations`,
  clientSummary: (clientId: string) => `/hepo/clients/${clientId}/summary`,
  assign: (clientId: string) => `/hepo/clients/${clientId}/obligations`,
  update: (id: string) => `/hepo/client-obligations/${id}`,
} as const;

/**
 * İzleme metrikleri (D3 / C6) — Prometheus metin biçimi.
 * NOT: genel önek DIŞINDADIR (standart /metrics yolu; global önek yok).
 */
export const METRICS_ROUTES = {
  metrics: "/metrics",
} as const;

/** Kıymet takdiri (İİK m.120) + satış kaydı (m.106+) — D4 / A6. */
export const ASSET_MARKET_ROUTES = {
  valuations: (assetId: string) => `/assets/${assetId}/valuations`,
  sales: (assetId: string) => `/assets/${assetId}/sales`,
} as const;

/** Konkordato / iflas süreç takibi (D4 / A6). */
export const CONCORDATO_ROUTES = {
  list: "/concordatos",
  create: "/concordatos",
  detail: (id: string) => `/concordatos/${id}`,
  transition: (id: string) => `/concordatos/${id}/transition`,
} as const;

/** Portal self-servis uçları (E9 randevu + E8 ödeme — token yetkidir). */
export const PORTAL_SELF_ROUTES = {
  randevular: "/portal/randevular",
  randevuIptal: (id: string) => `/portal/randevular/${id}/iptal`,
  odeme: (token: string) => `/portal/odeme/${token}`,
} as const;
