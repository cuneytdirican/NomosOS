/**
 * Sözleşme Analizi arayüz tipleri — `apps/api/src/contracts/contract-analysis*`
 * uç ve şemalarıyla birebir. Alan adları şemadaki camelCase adlardır; normalleştiriciler
 * (`contract-analysis.ts`) eksik alanı `null`'a indirger; hiçbir ekran alanın
 * varlığına GÜVENMEZ (faz5-types deseni).
 */

// ------------------------------------------------------------------ ortak

/** Tek taraf perspektifi bulgusu (ourSideJson / otherSideJson satırı). */
export interface ContractAnalysisFinding {
  rank: number;
  clauseRef: string | null;
  /** Bulgunun sanal sayfa konumu (parça bazlı analiz künyesi). */
  pageFrom: number | null;
  pageTo: number | null;
  severity: "KRITIK" | "ORTA" | "DUSUK" | null;
  title: string;
  body: string | null;
  proposedFix: string | null;
  quote: string | null;
  refs: string[];
}

/** Şerh — tek gerçek kaynak (AI önerir, avukat komutuyla kayda geçer). */
export interface ContractAnnotation {
  id: string;
  runId: string;
  clauseRef: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  severity: "KRITIK" | "ORTA" | "DUSUK" | null;
  explanation: string | null;
  quote: string | null;
  proposedFix: string | null;
  status: "ACIK" | "KAPALI" | "SUPERSEDED" | null;
  closedAt: string | null;
  closeNote: string | null;
  createdAt: string | null;
}

/** Koşunun parça (map-reduce) künyesi. */
export interface ContractRunChunks {
  count: number;
  ok: number;
  failed: number;
  pages: number;
}

export type ContractAnalysisMode = "ILK" | "REVIZYON" | "NIHAI";

export interface ContractAnalysisRunItem {
  id: string;
  contractId: string;
  versionId: string;
  mode: ContractAnalysisMode | null;
  overallRiskScore: number;
  riskBand: "DUSUK" | "ORTA" | "YUKSEK" | null;
  model: string | null;
  durationMs: number | null;
  createdAt: string | null;
  ourSide: ContractAnalysisFinding[];
  otherSide: ContractAnalysisFinding[];
  chunks: ContractRunChunks | null;
}

/** Analiz koşusu yanıtı (POST /contracts/:id/analyses). */
export interface ContractAnalysisResult {
  runId: string;
  contractId: string;
  versionId: string | null;
  versionNo: number | null;
  mode: ContractAnalysisMode | null;
  overallRiskScore: number;
  riskBand: "DUSUK" | "ORTA" | "YUKSEK" | null;
  ourSide: ContractAnalysisFinding[];
  otherSide: ContractAnalysisFinding[];
  overallNote: string | null;
  annotations: ContractAnnotation[];
  chunks: ContractRunChunks | null;
  chunkReports: {
    index: number;
    pageFrom: number | null;
    pageTo: number | null;
    status: "TAMAM" | "HATA";
    ourCount: number;
    otherCount: number;
    durationMs: number;
    errorNote: string | null;
  }[];
  droppedQuotes: {
    label: string;
    perspective: string;
    reasonLabel: string | null;
    quote: string | null;
    pageFrom: number | null;
    pageTo: number | null;
  }[];
  model: string | null;
  durationMs: number | null;
  createdAt: string | null;
}

/** Analiz tahmini (GET /contracts/:id/analyses/estimate) — AI'sız, kredisiz. */
export interface ContractAnalysisEstimate {
  contractId: string;
  versionId: string;
  versionNo: number;
  chars: number;
  pageCount: number;
  chunkCount: number;
  chunkChars: number;
  pricing: {
    parcaSayisi: number;
    parcaBasiKredi: number;
    tahminiKredi: number;
  };
  estimatedDurationMs: number;
}

/** Süreç akışı olayı (append-only). */
export interface ContractEventItem {
  id: string;
  type: string;
  detail: string | null;
  actor: { userId?: string; role?: string } | null;
  createdAt: string | null;
}

/** Sunucuda üretilmiş sürüm farkı — SAYFA PENCERELİ ve SAYFALANMIŞ. */
export interface ContractVersionDiffPage {
  page: number;
  status: "DEGISTI" | "EKLENDI" | "SILINDI";
  added: string[];
  removed: string[];
  changed: { before: string; after: string }[];
}

export interface ContractVersionDiffResult {
  id: string;
  versionA: { id: string; versionNo: number; changeNote: string | null };
  versionB: { id: string; versionNo: number; changeNote: string | null };
  counts: { added: number; removed: number; changed: number };
  pageCounts: { a: number | null; b: number | null };
  unchangedPages: number | null;
  /** Değişen sayfalar — SAYFALANMIŞ liste (yalnız istenen dilim). */
  pages: {
    items: ContractVersionDiffPage[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  createdAt: string | null;
}

/** Sürüm metninin sayfa aralığıyla okunan dilimi (GET /contract-versions/:id). */
export interface ContractVersionTextPage {
  id: string;
  versionNo: number;
  contentText: string;
  pageFrom: number;
  pageTo: number;
  pageCount: number;
  totalChars: number;
  changeNote: string | null;
}

/** Güncel risk özeti — AÇIK şerhlerden hesaplanır. */
export interface ContractRiskSummary {
  contractId: string;
  openAnnotations: number;
  counts: Record<string, Record<string, number>>;
  currentScore: number;
  currentBand: "DUSUK" | "ORTA" | "YUKSEK" | null;
  lastRun: { id: string; mode: string; overallRiskScore: number; createdAt: string } | null;
}

/** Liste kartı skor bandı: contractId → son koşu. */
export interface LatestScoreEntry {
  runId: string;
  mode: string;
  score: number;
  band: "DUSUK" | "ORTA" | "YUKSEK" | null;
  runAt: string;
}

/** Müvekkile bildirim yanıtı. */
export interface NotifyClientResult {
  messageId: string;
  contractId: string;
  clientId: string | null;
  published: boolean;
  criticalCount: number;
  openCount: number;
  summaryPreview: string | null;
  note: string | null;
}

/** Sözleşme metninden çıkarılmış madde bloğu. */
export interface ContractClauseBlock {
  ref: string;
  /** Madde numarası (m.7) — şerh eşleştirmesinde kullanılır. */
  number: number | null;
  text: string;
}
