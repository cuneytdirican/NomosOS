/**
 * Faz 4 görünüm tipleri — Strateji, Simülasyon, Risk, Delil, Bilirkişi, Çakışma.
 *
 * Alan adları `packages/db/prisma/schema.prisma` (migration
 * `20260902090000_faz4_ai_derinlik_krediler`) ile birebir hizalıdır. API henüz
 * paralel yazıldığı için ÇOĞU ALAN OPSİYONELDİR: eksik alan ekranı çökertmez,
 * yalnızca ilgili satır "—" gösterir.
 *
 * Bu dosya `app/app/_lib` altındadır: alt çizgiyle başlayan klasörler Next.js
 * yönlendirme ağacının DIŞINDADIR, dolayısıyla bir rota üretmez.
 */

// ---------------------------------------------------------------- ortak

export interface UserRef {
  id?: string;
  fullName?: string | null;
  email?: string | null;
}

export interface CaseRef {
  id: string;
  title?: string | null;
  fileNumber?: string | null;
  courtName?: string | null;
  status?: string | null;
  type?: string | null;
  responsibleUser?: UserRef | null;
  client?: { id: string; name?: string | null } | null;
}

/** AI çıktılarının dayandığı kaynak ("hangi belgeye dayandın"). */
export interface SourceRef {
  documentId?: string | null;
  documentName?: string | null;
  locator?: string | null;
  quote?: string | null;
  label?: string | null;
}

// ------------------------------------------------------------- strateji

export type StrategyStatus = "TASLAK" | "GUNCEL" | "BAYAT";

export type StrategyNodeType =
  | "KARSI_ARGUMAN"
  | "BIZIM_ARGUMAN"
  | "DELIL"
  | "HUKUKI_DAYANAK"
  | "ZAYIF_NOKTA"
  | "KARSI_CEVAP"
  | "SENARYO"
  | "RISK";

export interface StrategyNode {
  id: string;
  strategyId?: string;
  parentId?: string | null;
  nodeType: StrategyNodeType | string;
  content: string;
  /** Enum (DUSUK/ORTA/YUKSEK) ya da 1–10 sayısı olabilir. */
  strength?: string | number | null;
  sourceRef?: string | null;
  orderIndex?: number | null;
  createdAt?: string;
  children?: StrategyNode[];
}

export interface StrategyVersion {
  id: string;
  strategyId?: string;
  versionNo: number;
  treeJson?: unknown;
  summary?: string | null;
  model?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

export interface Strategy {
  id: string;
  caseId?: string;
  title: string;
  status: StrategyStatus | string;
  currentVersionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  nodes?: StrategyNode[];
  versions?: StrategyVersion[];
  currentVersion?: StrategyVersion | null;
  /** Strateji neden BAYAT? (sunucu doldurursa uyarı şeridinde gösterilir) */
  staleReason?: string | null;
}

// ----------------------------------------------------------- simülasyon

export type SimulationMode =
  | "KARSI_TARAF_AVUKATI"
  | "HAKIM_GOZU"
  | "KAYBETTIREN_HUSUSLAR"
  | "KARSI_DILEKCE_ZAYIFLIK"
  | "BILIRKISI_ODAGI";

export interface SimulationRun {
  id: string;
  caseId?: string;
  mode: SimulationMode | string;
  inputSnapshotJson?: unknown;
  outputJson?: unknown;
  model?: string | null;
  durationMs?: number | null;
  status?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  user?: UserRef | null;
}

/**
 * Mod çıktılarının EKRANA İNDİRGENMİŞ ortak biçimi.
 *
 * Her mod farklı bir JSON şeması döndürür (Modül 16); arayüz bunları tek bir
 * "bulgu" listesine indirger ki karşılaştırma ve listeleme tek kodla yürüsün.
 * İndirgeme `simulationFindings()` içindedir; ham çıktı her zaman ayrıca
 * gösterilebilir.
 */
export interface SimFinding {
  key: string;
  rank?: number | null;
  title: string;
  severity?: string | null;
  /** Etiket → değer satırları (mod'a göre değişen alanlar). */
  fields: Array<{ label: string; value: string }>;
  quote?: string | null;
  sourceRefs?: SourceRef[];
  citations?: Array<{ ref?: string; kind?: string; verified?: boolean }>;
}

// ------------------------------------------------------------------ risk

export type RiskDimension =
  | "GENEL"
  | "HUKUKI"
  | "SURE"
  | "DELIL"
  | "TAHSILAT"
  | "USUL"
  | "ICTIHAT"
  | "KARSI_TARAF";

export type RiskBand = "DUSUK" | "ORTA" | "YUKSEK";

export interface RiskSignal {
  source?: "KURAL" | "AI" | "RULE" | string | null;
  code?: string | null;
  points?: number | null;
  reason?: string | null;
  refs?: unknown;
}

export interface RiskScore {
  id?: string;
  caseId?: string;
  dimension: RiskDimension | string;
  score: number;
  band?: RiskBand | string | null;
  /** Kural sinyalleri — dizi ya da `{ signals: [...] }` gelebilir. */
  ruleSignalsJson?: unknown;
  /** −25..+25 arası AI düzeltmesi. Bandı TEK BAŞINA değiştiremez. */
  aiAdjustment?: number | null;
  aiCommentary?: string | null;
  model?: string | null;
  computedAt?: string | null;
  computedBy?: string | null;
  /** Elle ezme varsa sunucu bu alanları doldurur. */
  override?: RiskOverride | null;
  isOverridden?: boolean;
}

export interface RiskOverride {
  id?: string;
  caseId?: string;
  dimension: RiskDimension | string;
  band: RiskBand | string;
  reason: string;
  createdBy?: string | null;
  createdAt?: string;
  expiresAt?: string | null;
}

export interface CaseRisk {
  caseId?: string;
  scores: RiskScore[];
  overrides?: RiskOverride[];
  computedAt?: string | null;
}

/** Büro geneli riskli dosya satırı (GET /risk/office). */
export interface RiskCaseRow {
  caseId: string;
  case?: CaseRef | null;
  caseTitle?: string | null;
  fileNumber?: string | null;
  score: number;
  band?: RiskBand | string | null;
  /** En baskın (en yüksek skorlu) boyut. */
  topDimension?: RiskDimension | string | null;
  dimension?: RiskDimension | string | null;
  responsibleUser?: UserRef | null;
  computedAt?: string | null;
  scores?: RiskScore[];
}

// ----------------------------------------------------------------- delil

export type ClaimSide = "BIZ" | "KARSI_TARAF";
export type ClaimStatus = "ACIK" | "DESTEKLENIYOR" | "ZAYIF" | "CURUTULDU";

export type EvidenceType =
  | "BELGE"
  | "FOTOGRAF"
  | "VIDEO"
  | "SES"
  | "TANIK"
  | "BILIRKISI"
  | "KESIF"
  | "DIGER";

export type EvidenceStatus = "PLANLANAN" | "TOPLANDI" | "SUNULDU" | "KABUL" | "RED";

export interface ClaimEvidenceLink {
  id: string;
  claimId: string;
  evidenceId: string;
  /** 1-5 tamsayı (sunucu şeması z.number().int()). */
  strength?: string | number | null;
  /** Bağın YÖNÜ (F2 · E6): SUPPORTS · CONTRADICTS · BELIRSIZ. */
  linkType?: "SUPPORTS" | "CONTRADICTS" | "BELIRSIZ" | string | null;
  note?: string | null;
  createdAt?: string;
  evidence?: Evidence | null;
}

export interface ClaimLegalBasis {
  id: string;
  claimId: string;
  reference: string;
  caseLawId?: string | null;
  note?: string | null;
  createdAt?: string;
}

export interface Claim {
  id: string;
  caseId?: string;
  side: ClaimSide | string;
  text: string;
  orderIndex?: number | null;
  status: ClaimStatus | string;
  createdAt?: string;
  updatedAt?: string;
  evidenceLinks?: ClaimEvidenceLink[];
  legalBases?: ClaimLegalBasis[];
}

export interface Evidence {
  id: string;
  caseId?: string;
  type: EvidenceType | string;
  title: string;
  description?: string | null;
  documentId?: string | null;
  witnessName?: string | null;
  obtainedAt?: string | null;
  status: EvidenceStatus | string;
  createdAt?: string;
  claimLinks?: ClaimEvidenceLink[];
}

/** İstemcide birleştirilmiş matris (iddia × delil). */
export interface EvidenceMatrix {
  claims: Claim[];
  evidences: Evidence[];
  /** `claimId::evidenceId` → bağ. */
  linkIndex: Map<string, ClaimEvidenceLink>;
}

/** AI matris önerisi — TEK TEK eklenir, toplu uygulama yoktur. */
export interface EvidenceSuggestion {
  id?: string;
  kind?: "IDDIA" | "DELIL" | "BAG" | "DAYANAK" | string;
  claimId?: string | null;
  claimText?: string | null;
  side?: ClaimSide | string | null;
  evidenceId?: string | null;
  evidenceTitle?: string | null;
  evidenceType?: EvidenceType | string | null;
  reference?: string | null;
  strength?: string | number | null;
  reason?: string | null;
  sourceRefs?: SourceRef[];
}

export interface EvidenceGap {
  claimId?: string | null;
  claimText?: string | null;
  issue?: string | null;
  severity?: string | null;
  suggestedEvidence?: string | null;
  sourceRefs?: SourceRef[];
}

// ------------------------------------------------------------- bilirkişi

export type ExpertReportType = "ASIL" | "EK" | "UZMAN_MUTALAASI";
export type ObjectionStatus = "TASLAK" | "SUNULDU" | "KABUL" | "RED";

export interface Expert {
  id: string;
  fullName: string;
  specialty?: string | null;
  institution?: string | null;
  note?: string | null;
}

export interface ExpertObjection {
  id: string;
  expertReportId: string;
  petitionId?: string | null;
  points: string;
  status: ObjectionStatus | string;
  deadlineId?: string | null;
  createdAt?: string;
}

export interface ExpertReport {
  id: string;
  caseId?: string;
  expertId?: string | null;
  expert?: Expert | null;
  reportType: ExpertReportType | string;
  documentId?: string | null;
  receivedAt: string;
  servedAt?: string | null;
  summary?: string | null;
  conclusionText?: string | null;
  createdAt?: string;
  objections?: ExpertObjection[];
}

/** Tebliğ tarihi girildiğinde sunucunun döndürdüğü süre önerisi (varsa). */
export interface DeadlineSuggestion {
  title?: string | null;
  dueDate?: string | null;
  ruleKey?: string | null;
  legalBasis?: string | null;
  computeNote?: unknown;
  note?: string | null;
}

export interface ExpertReportPatchResult extends ExpertReport {
  deadlineSuggestion?: DeadlineSuggestion | null;
}

export interface ExpertDiffItem {
  topic?: string | null;
  baseFinding?: string | null;
  compareFinding?: string | null;
  baseQuote?: string | null;
  compareQuote?: string | null;
  direction?: string | null;
  note?: string | null;
}

export interface ExpertReportDiff {
  id?: string;
  caseId?: string;
  baseReportId?: string;
  compareReportId?: string;
  diffJson?: unknown;
  model?: string | null;
  createdAt?: string;
  items?: ExpertDiffItem[];
}

export interface ObjectionDraft {
  points?: string | null;
  summary?: string | null;
  model?: string | null;
  warnings?: string[];
  sourceRefs?: SourceRef[];
}

// --------------------------------------------------------------- çakışma

export type ConflictResult = "TEMIZ" | "DIKKAT" | "CAKISMA";
export type ConflictDecision = "DEVAM" | "REDDEDILDI" | "BEKLEMEDE";
export type ConflictMatchType =
  | "MEVCUT_MUVEKKIL"
  | "KARSI_TARAF"
  | "ESKI_MUVEKKIL"
  | "BAGLI_SIRKET"
  | "DOSYADA_GECEN"
  | "BENZER_AD";

export interface ConflictHit {
  id: string;
  conflictCheckId?: string;
  matchType: ConflictMatchType | string;
  entityType: string;
  entityId?: string | null;
  matchedName: string;
  /** 0–1 (ya da 0–100) benzerlik. */
  similarity: number;
  caseId?: string | null;
  case?: CaseRef | null;
  note?: string | null;
}

export interface ConflictCheck {
  id: string;
  query: string;
  context?: string | null;
  result: ConflictResult | string;
  hitCount?: number;
  decidedBy?: string | null;
  decision?: ConflictDecision | string | null;
  decisionNote?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  hits?: ConflictHit[];
  user?: UserRef | null;
}
