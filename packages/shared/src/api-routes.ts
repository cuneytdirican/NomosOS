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
   * TAHSİLAT KAYDI FATURA ALTINDA DEĞİL, KENDİ UCUNDADIR ve gövdesinde
   * `clientId` + `invoiceId` taşır (tahsilat faturasız da kaydedilebilir).
   */
  payments: "/billing/payments",
  payment: (id: string) => `/billing/payments/${id}`,

  eInvoiceProvider: "/billing/e-invoice/provider",
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
} as const;

export const USERS_ROUTES = {
  list: "/users",
  manage: "/users/manage",
  create: "/users",
  detail: (id: string) => `/users/${id}`,
  resetPassword: (id: string) => `/users/${id}/reset-password`,
  revokeSessions: (id: string) => `/users/${id}/revoke-sessions`,
  unlock: (id: string) => `/users/${id}/unlock`,
} as const;

export const CLIENTS_ROUTES = {
  list: "/clients",
  create: "/clients",
  detail: (id: string) => `/clients/${id}`,
  tckn: (id: string) => `/clients/${id}/tckn`,
  contacts: (id: string) => `/clients/${id}/contacts`,
  contact: (id: string, contactId: string) => `/clients/${id}/contacts/${contactId}`,
} as const;

export const CASES_ROUTES = {
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

/** AI kota/kredi sistemi (Modül 26). */
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
  live: "/health/live",
} as const;
