/**
 * API yanıtları için görünüm tipleri.
 * Alan adları packages/db/prisma/schema.prisma ile uyumludur;
 * API henüz gelişirken kırılganlığı azaltmak için çoğu alan opsiyoneldir.
 */
import type {
  AiProviderType,
  CaseStatus,
  CaseType,
  ClientType,
  DeadlineSource,
  DeadlineStatus,
  HearingType,
  PartyRole,
  TaskPriority,
  TaskStatus,
} from "@nomosos/shared";

export type HearingStatus = "PLANLANDI" | "YAPILDI" | "ERTELENDI" | "IPTAL";
export type ServiceMethod = "ELDEN" | "POSTA" | "ETEBLIGAT" | "DURUSMADA" | "DIGER";
export type DurationUnit = "GUN" | "HAFTA" | "AY" | "YIL";
export type DecisionType =
  | "ARA_KARAR"
  | "GEREKCELI_KARAR"
  | "ISTINAF_KARARI"
  | "TEMYIZ_KARARI"
  | "KESIN_KARAR";

export interface ClientContact {
  id: string;
  clientId?: string;
  fullName: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface Client {
  id: string;
  type: ClientType;
  name: string;
  email?: string | null;
  phone?: string | null;
  /**
   * KVKK: sunucu ham TCKN döndürmez; yalnızca maskeli değer gelir.
   * Ham değer için yetkilendirilmiş `GET /clients/:id/tckn` ucu kullanılır.
   */
  tcknMasked?: string | null;
  taxNumber?: string | null;
  taxOffice?: string | null;
  address?: string | null;
  iban?: string | null;
  notes?: string | null;
  category?: string | null;
  referenceCode?: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  contacts?: ClientContact[];
  cases?: CaseSummary[];
  financialEntries?: FinancialEntry[];
  _count?: { cases?: number; contacts?: number };
}

export interface FinancialEntry {
  id: string;
  type: string;
  amount: string | number;
  currency?: string;
  date?: string;
  description?: string | null;
}

/** GET /clients/:id/summary — varsa kullanılır, yoksa istemci tarafında hesaplanır. */
export interface ClientSummary {
  caseCounts?: Record<string, number>;
  totalCases?: number;
  openCases?: number;
  finance?: {
    accrued?: number;
    collected?: number;
    balance?: number;
    expenses?: number;
    currency?: string;
  };
  upcomingHearings?: Hearing[];
  upcomingDeadlines?: Deadline[];
  lastActivityAt?: string | null;
}

export interface CaseParty {
  id: string;
  role: PartyRole;
  name: string;
  isClient?: boolean;
  /** D8 — taraf büro müvekkiliyse kart bağlantısı (ad sunucuda karttan doldurulur). */
  clientId?: string | null;
  lawyerName?: string | null;
}

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  detail?: string | null;
  source?: string | null;
  user?: { id: string; fullName?: string } | null;
}

export interface Hearing {
  id: string;
  caseId: string;
  type?: HearingType;
  status?: HearingStatus | string;
  date: string;
  courtroom?: string | null;
  note?: string | null;
  preparedAt?: string | null;
  prepSummary?: string | null;
  case?: CaseSummary | null;
}

export interface Deadline {
  id: string;
  caseId: string;
  title: string;
  dueDate: string;
  source?: DeadlineSource;
  status?: DeadlineStatus;
  legalBasis?: string | null;
  computeNote?: string | null;
  ruleKey?: string | null;
  triggerDate?: string | null;
  serviceMethod?: ServiceMethod | null;
  owner?: { id: string; fullName?: string } | null;
  case?: CaseSummary | null;
}

export interface DeadlineRule {
  id: string;
  tenantId?: string | null;
  key: string;
  name: string;
  description?: string | null;
  durationValue: number;
  durationUnit: DurationUnit;
  legalBasis: string;
  caseTypes?: string[];
  isActive?: boolean;
  isSystem?: boolean;
}

/** POST /deadlines/compute yanıtı — hesap izi UI'da adım adım gösterilir. */
export interface DeadlineComputationStep {
  step: string;
  date: string;
  explanation: string;
}

export interface DeadlineComputationResult {
  dueDate: string;
  steps?: DeadlineComputationStep[];
  legalBasis?: string;
  warnings?: string[];
}

export interface TaskStatusLog {
  id: string;
  fromStatus?: TaskStatus | null;
  toStatus: TaskStatus;
  note?: string | null;
  createdAt: string;
  user?: { id: string; fullName?: string } | null;
}

export interface Task {
  id: string;
  caseId?: string | null;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  assignee?: { id: string; fullName?: string } | null;
  reviewer?: { id: string; fullName?: string } | null;
  case?: CaseSummary | null;
  statusLogs?: TaskStatusLog[];
}

export interface CaseDocument {
  id: string;
  name: string;
  class?: string;
  classSource?: string | null;
  aiSummary?: string | null;
  createdAt?: string;
}

export interface CaseNote {
  id: string;
  caseId?: string;
  content: string;
  isPinned?: boolean;
  createdAt?: string;
  updatedAt?: string;
  user?: { id: string; fullName?: string } | null;
}

export interface CaseDecision {
  id: string;
  caseId?: string;
  type: DecisionType;
  date: string;
  summary: string;
  outcome?: string | null;
  documentId?: string | null;
  createdAt?: string;
}

export interface CaseSummary {
  id: string;
  title: string;
  type?: CaseType;
  status?: CaseStatus;
  courtName?: string | null;
  fileNumber?: string | null;
  nextHearingAt?: string | null;
  lastActivityAt?: string | null;
  client?: { id: string; name: string } | null;
}

export interface CaseDetail extends CaseSummary {
  type: CaseType;
  status: CaseStatus;
  judgeName?: string | null;
  subject?: string | null;
  amount?: string | number | null;
  openedAt?: string;
  responsibleUser?: { id: string; fullName?: string } | null;
  parties?: CaseParty[];
  timelineEvents?: TimelineEvent[];
  hearings?: Hearing[];
  deadlines?: Deadline[];
  tasks?: Task[];
  documents?: CaseDocument[];
  notes?: CaseNote[];
  decisions?: CaseDecision[];
}

/**
 * GET /dashboard/summary.
 * API sayı ya da liste dönebilir; lib/dashboard.ts içindeki yardımcılar
 * her iki biçimi de tolere eder.
 */
export interface DashboardSummary {
  activeCases?: unknown;
  clientCount?: number;
  openTasks?: unknown;
  hearingsThisWeek?: unknown;
  criticalDeadlines?: unknown;
  riskyDeadlines?: unknown;
  myTasks?: unknown;
  counts?: Record<string, number>;
}

export interface AiProvider {
  id: string;
  name: string;
  type: AiProviderType;
  baseUrl?: string | null;
  defaultModel: string;
  headersJson?: string | null;
  mappingJson?: string | null;
  isActive?: boolean;
  hasApiKey?: boolean;
  /** TANIMLI | IMPORTED — dışarıda eğitilmiş model kaydı içe aktarıldı. */
  origin?: string;
}

export interface AiTaskRoute {
  id?: string;
  taskType: string;
  providerConfigId: string;
  model: string;
}

/** POST /ai/chat — 409 requiresPiiApproval gövdesi. */
export interface PiiApprovalPayload {
  requiresPiiApproval?: boolean;
  maskedMessage?: string;
  maskedText?: string;
  findings?: Array<{
    /** TCKN | IBAN | TELEFON | EPOSTA */
    kind?: string;
    type?: string;
    label?: string;
    /** Ham değer ARTIK DÖNMEZ; `masked` kısmi maskedir ("123******01"). */
    value?: string;
    original?: string;
    masked?: string;
    count?: number;
  }>;
  message?: string;
}

export interface ChatResponse {
  reply?: string;
  content?: string;
  answer?: string;
  message?: string;
  text?: string;
  model?: string;
  usedModel?: string;
  provider?: string;
  sessionId?: string;
  citations?: Citation[];
  citationsJson?: Citation[];
  sources?: Citation[];
  warnings?: string[];
  degraded?: boolean;
  retrievalMode?: string;
}

// =====================================================================
// Faz 2 — belge hattı, öneri kuyruğu, asistan, dilekçe, içtihat
// =====================================================================

export type ProcessingStatus = "BEKLIYOR" | "TAMAM" | "BASARISIZ" | "GEREKSIZ";
export type PipelineStatus = "BEKLIYOR" | "CALISIYOR" | "TAMAM" | "BASARISIZ" | "KISMI";
export type ProposalType =
  | "GOREV"
  | "SURE"
  | "SAFAHAT"
  | "MUVEKKIL_BILGILENDIRME"
  | "DOSYA_ESLESTIRME"
  | "DURUSMA_GUNCELLEME";
export type ProposalStatus = "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI" | "UYGULANDI";
export type PetitionType =
  | "DAVA_DILEKCESI"
  | "CEVAP"
  | "CEVABA_CEVAP"
  | "IKINCI_CEVAP"
  | "ISTINAF"
  | "TEMYIZ"
  | "ITIRAZ"
  | "DELIL_LISTESI"
  | "ISLAH"
  | "BILIRKISI_ITIRAZ"
  | "ICRA_TAKIP_TALEBI"
  | "SIKAYET"
  | "BEYAN"
  | "DIGER";
export type PetitionStatus =
  | "TASLAK"
  | "TEYIT_EDILIYOR"
  | "TEYIT_EDILDI"
  | "INCELEMEDE"
  | "HAZIR"
  | "DISA_AKTARILDI"
  | "GONDERILDI";
export type RefStatus = "ADAY" | "KABUL" | "RED";
export type CitationStatus = "DOGRULANDI" | "BULUNAMADI" | "BELIRSIZ";
export type NoteKind = "GENEL" | "DURUSMA_HAZIRLIK" | "STRATEJI" | "HATIRLATMA";
export type NoteSource = "MANUEL" | "AI";

/** GET /documents — belge kaydı (Faz 2 alanlarıyla). */
export interface DocumentItem extends CaseDocument {
  caseId?: string | null;
  mimeType?: string | null;
  size?: number | null;
  sizeBytes?: number | null;
  pageCount?: number | null;
  hash?: string | null;
  source?: string | null;
  storageKey?: string | null;
  ocrStatus?: ProcessingStatus | null;
  chunkStatus?: ProcessingStatus | null;
  classConfidence?: number | null;
  confidence?: number | null;
  uploadedBy?: { id: string; fullName?: string } | null;
  case?: CaseSummary | null;
  _count?: { proposals?: number; chunks?: number };
}

export interface PipelineStepInfo {
  key?: string;
  name?: string;
  status?: string;
  message?: string | null;
  durationMs?: number | null;
}

/** GET /documents/:id/pipeline */
export interface PipelineRun {
  id: string;
  documentId?: string;
  status: PipelineStatus;
  startedAt?: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
  steps?: PipelineStepInfo[];
  stepsJson?: PipelineStepInfo[] | null;
  proposalCount?: number;
}

/** GET /proposals — avukat onayı bekleyen AI aksiyon önerisi. */
export interface ActionProposal {
  id: string;
  documentId?: string | null;
  caseId?: string | null;
  type: ProposalType;
  status: ProposalStatus;
  title: string;
  payloadJson?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  confidence?: number | null;
  reasoning?: string | null;
  sourceQuote?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  createdAt?: string;
  document?: { id: string; name?: string } | null;
  case?: CaseSummary | null;
}

/** AI cevabının altındaki kaynak künyesi. */
export interface Citation {
  id?: string;
  documentId?: string | null;
  /** API'nin DOCUMENT referanslarında kullandığı belge kimliği alanı. */
  refId?: string | null;
  documentName?: string | null;
  chunkId?: string | null;
  chunkIndex?: number | null;
  index?: number | null;
  label?: string | null;
  sourceLabel?: string | null;
  quote?: string | null;
  snippet?: string | null;
  text?: string | null;
  score?: number | null;
  page?: number | null;
  /** DOCUMENT | TIMELINE | DEADLINE | CASELAW | STATUTE */
  kind?: string | null;
  /**
   * Referans DOĞRULANDI mı?
   *
   * DOCUMENT/TIMELINE/DEADLINE künyeleri erişilen parçalara karşı denetlenir
   * (true). CASELAW/STATUTE künyeleri modelin METNİNDEN çıkarılmıştır ve
   * TEYİT EDİLMEMİŞTİR (false) — arayüz bunları kaynak gibi göstermez,
   * ayrı bir blokta "TEYİT EDİLMEDİ" rozetiyle sunar.
   */
  verified?: boolean;
}

/** Süre kuralı seçeneği (SURE önerisinde kural seçimi). */
export interface DeadlineRuleOption {
  id?: string;
  key: string;
  name: string;
  durationDays?: number | null;
  legalBasis?: string | null;
  isActive?: boolean;
}

/** Büro kullanıcı listesi (öneri onayında sorumlu seçimi). */
export interface TenantUser {
  id: string;
  fullName: string;
  role: "ADMIN" | "PARTNER" | "AVUKAT" | "STAJYER" | "SEKRETER";
}

export interface ChatSessionInfo {
  id: string;
  caseId?: string | null;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  _count?: { messages?: number };
}

export interface ChatMessageItem {
  id?: string;
  sessionId?: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "user" | "assistant" | "system";
  content: string;
  citationsJson?: Citation[] | null;
  citations?: Citation[] | null;
  model?: string | null;
  createdAt?: string;
}

export interface AnalysisReport {
  id: string;
  caseId?: string;
  contentJson?: Record<string, unknown> | null;
  content?: Record<string, unknown> | null;
  model?: string | null;
  createdBy?: string;
  createdAt?: string;
}

export interface SmartNoteItem {
  id: string;
  caseId?: string;
  content: string;
  kind?: NoteKind;
  source?: NoteSource;
  isApproved?: boolean;
  createdAt?: string;
}

export interface PetitionTemplateItem {
  id: string;
  tenantId?: string | null;
  key: string;
  name: string;
  petitionType: PetitionType;
  sectionsJson?: PetitionSectionSpec[] | null;
  sections?: PetitionSectionSpec[] | null;
  isSystem?: boolean;
}

export interface PetitionSectionSpec {
  title: string;
  hint?: string | null;
  required?: boolean;
}

/** Bir dilekçe sürümündeki bölüm (başlık + gövde). */
export interface PetitionSection {
  title: string;
  body?: string;
  content?: string;
  text?: string;
  hint?: string | null;
  required?: boolean;
}

export interface PetitionSummary {
  id: string;
  caseId?: string;
  templateId?: string | null;
  type: PetitionType;
  title: string;
  status: PetitionStatus;
  currentVersionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { versions?: number };
}

export interface PetitionVersionItem {
  id: string;
  petitionId?: string;
  versionNo: number;
  sectionsJson?: PetitionSection[] | null;
  sections?: PetitionSection[] | null;
  plainText?: string;
  note?: string | null;
  createdBy?: string;
  createdAt?: string;
}

export interface CitationCheckItem {
  id?: string;
  rawCitation: string;
  status: CitationStatus;
  note?: string | null;
  checkedAt?: string;
  /** ICTIHAT | MEVZUAT | TANINMADI */
  kind?: string | null;
  /** Eşleşen kayıt [DEMO VERİ] mi? Demo kayıt gerçek karar değildir. */
  isDemo?: boolean;
  /** Kapı bu atfı neden blokladı / ne yapılmalı (422 gövdesinden). */
  reason?: string | null;
  remedy?: string | null;
}

/** Teyit kapısının kararı (API: `readyGate`). */
export interface ReadyGate {
  ok: boolean;
  total: number;
  verified: number;
  blocking: Array<{
    raw: string;
    kind: "ICTIHAT" | "MEVZUAT" | "TANINMADI";
    status: CitationStatus;
    reason: string;
    remedy: string;
  }>;
  statuteDeclarationsRequired: string[];
  statuteDeclarationsAccepted: string[];
  /** Teyit hiç çalıştırılmadıysa false — "tamam" DEĞİL, "bilinmiyor" demektir. */
  verificationRun?: boolean;
}

export interface PetitionDetail extends PetitionSummary {
  currentVersion?: PetitionVersionItem | null;
  versions?: PetitionVersionItem[];
  /** API alan adı `verification`tır (eski `citationChecks` değil). */
  verification?: CitationCheckItem[];
  /** Metinde geçip henüz teyit çalıştırılmamış ham künyeler. */
  unverifiedInText?: string[];
  readyGate?: ReadyGate;
  citationChecks?: CitationCheckItem[];
  verifyStatus?: string | null;
  template?: PetitionTemplateItem | null;
  case?: CaseSummary | null;
}

export interface CaseLawDoc {
  id: string;
  court: string;
  chamber?: string | null;
  caseNumber: string;
  decisionNumber: string;
  decisionDate?: string | null;
  summary?: string | null;
  fullText?: string | null;
  sourceUrl?: string | null;
  sourceAdapter?: string;
  fetchedAt?: string;
  score?: number | null;
  relevanceNote?: string | null;
  /** Sunucunun demo işareti (DEMO_SOURCE_ADAPTERS) — istemci kendisi karar vermez. */
  isDemo?: boolean;
}

/** GET /caselaw/:id — karar detayı (tam metin + bu büronun emsal bağları). */
export interface CaseLawDocDetail extends CaseLawDoc {
  fullText?: string | null;
  isDemo?: boolean;
  linkedCases?: Array<{
    referenceId: string;
    status?: string;
    relevanceNote?: string | null;
    case: { id: string; title: string; fileNumber?: string | null; courtName?: string | null };
  }>;
}

export interface CaseLawRef {
  id: string;
  caseId?: string;
  caseLawId: string;
  status: RefStatus;
  relevanceNote?: string | null;
  addedBy?: string;
  createdAt?: string;
  caseLaw?: CaseLawDoc | null;
}
