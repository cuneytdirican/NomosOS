/**
 * Sözleşme Analizi API istemcisi — sunucudaki `contract-analysis.controller.ts`
 * yollarıyla birebir.
 *
 *   GET  /contracts/analyses/latest-scores
 *   GET  /contracts/:id/analyses · POST /contracts/:id/analyses
 *   GET  /contracts/:id/analyses/:runId
 *   GET  /contracts/:id/annotations · POST .../annotations/:aid/close
 *   GET  /contracts/:id/diff · GET /contracts/:id/events
 *   GET  /contracts/:id/risk-summary
 *   POST /contracts/:id/notify-client · GET/PUT /contracts/:id/notify-setting
 *
 * MADDE BÖLME (splitClauses) buradadır: sunucu şerhleri "m.7" gibi metin
 * referanslarıyla saklar; arayüz metni madde bloklarına böler ve şerhi
 * kenarlığı renklendirilmiş bloğa bağlar. Kaynak metin TEK YERDE bölünür ki
 * blok ve şerh eşleşmesi ekranlar arasında ayrışmasın.
 */

import { api, asList } from "@/lib/api";
import type { ContractVersionItem } from "./faz5-types";
import type {
  ContractAnalysisEstimate,
  ContractAnalysisFinding,
  ContractAnalysisMode,
  ContractAnalysisResult,
  ContractAnalysisRunItem,
  ContractAnnotation,
  ContractClauseBlock,
  ContractEventItem,
  ContractRiskSummary,
  ContractVersionDiffResult,
  ContractVersionTextPage,
  LatestScoreEntry,
  NotifyClientResult,
} from "./contract-analysis-types";

export const CONTRACT_ANALYSIS_ROUTES = {
  latestScores: "/contracts/analyses/latest-scores",
  analyses: (contractId: string) => `/contracts/${contractId}/analyses`,
  analysis: (contractId: string, runId: string) => `/contracts/${contractId}/analyses/${runId}`,
  analysisEstimate: (contractId: string) => `/contracts/${contractId}/analyses/estimate`,
  annotations: (contractId: string) => `/contracts/${contractId}/annotations`,
  closeAnnotation: (contractId: string, annotationId: string) =>
    `/contracts/${contractId}/annotations/${annotationId}/close`,
  diff: (contractId: string) => `/contracts/${contractId}/diff`,
  events: (contractId: string) => `/contracts/${contractId}/events`,
  riskSummary: (contractId: string) => `/contracts/${contractId}/risk-summary`,
  notifyClient: (contractId: string) => `/contracts/${contractId}/notify-client`,
  notifySetting: (contractId: string) => `/contracts/${contractId}/notify-setting`,
} as const;

// ------------------------------------------------------------ normalleştirme

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function toFinding(raw: unknown): ContractAnalysisFinding {
  const o = obj(raw);
  return {
    rank: num(o.rank) ?? 0,
    clauseRef: str(o.clauseRef),
    pageFrom: num(o.pageFrom),
    pageTo: num(o.pageTo),
    severity: (str(o.severity) as ContractAnalysisFinding["severity"]) ?? null,
    title: str(o.title) ?? "(bulgu)",
    body: str(o.body) ?? str(o.explanation),
    proposedFix: str(o.proposedFix),
    quote: str(o.quote),
    refs: asList<unknown>(o.refs)
      .map((r) => (typeof r === "string" ? r : null))
      .filter((r): r is string => Boolean(r)),
  };
}

function toAnnotation(raw: unknown): ContractAnnotation {
  const o = obj(raw);
  return {
    id: str(o.id) ?? "",
    runId: str(o.runId) ?? "",
    clauseRef: str(o.clauseRef),
    pageFrom: num(o.pageFrom),
    pageTo: num(o.pageTo),
    severity: (str(o.severity) as ContractAnnotation["severity"]) ?? null,
    explanation: str(o.explanation) ?? str(o.body),
    quote: str(o.quote),
    proposedFix: str(o.proposedFix),
    status: (str(o.status) as ContractAnnotation["status"]) ?? null,
    closedAt: str(o.closedAt),
    closeNote: str(o.closeNote),
    createdAt: str(o.createdAt),
  };
}

function toChunks(raw: unknown): ContractAnalysisRunItem["chunks"] {
  const o = obj(raw);
  if (o.count === undefined) return null;
  return {
    count: num(o.count) ?? 0,
    ok: num(o.ok) ?? 0,
    failed: num(o.failed) ?? 0,
    pages: num(o.pages) ?? 0,
  };
}

function toRun(raw: unknown): ContractAnalysisRunItem {
  const o = obj(raw);
  return {
    id: str(o.id) ?? "",
    contractId: str(o.contractId) ?? "",
    versionId: str(o.versionId) ?? "",
    mode: (str(o.mode) as ContractAnalysisRunItem["mode"]) ?? null,
    overallRiskScore: num(o.overallRiskScore) ?? 0,
    riskBand: (str(o.riskBand) as ContractAnalysisRunItem["riskBand"]) ?? null,
    model: str(o.model),
    durationMs: num(o.durationMs),
    createdAt: str(o.createdAt),
    ourSide: asList<unknown>(o.ourSide).map(toFinding),
    otherSide: asList<unknown>(o.otherSide).map(toFinding),
    chunks: toChunks(o.chunks),
  };
}

// ------------------------------------------------------------ uç çağrıları

export function listLatestScores(): Promise<Record<string, LatestScoreEntry>> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.latestScores).then((raw) => {
    const out: Record<string, LatestScoreEntry> = {};
    for (const [key, value] of Object.entries(obj(raw))) {
      const o = obj(value);
      out[key] = {
        runId: str(o.runId) ?? "",
        mode: str(o.mode) ?? "",
        score: num(o.score) ?? 0,
        band: (str(o.band) as LatestScoreEntry["band"]) ?? null,
        runAt: str(o.runAt) ?? "",
      };
    }
    return out;
  });
}

export function listAnalyses(contractId: string): Promise<ContractAnalysisRunItem[]> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.analyses(contractId)).then((p) =>
    asList<unknown>(obj(p).items ?? p).map(toRun),
  );
}

export function getAnalysis(
  contractId: string,
  runId: string,
): Promise<{ run: ContractAnalysisRunItem; annotations: ContractAnnotation[] }> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.analysis(contractId, runId)).then((raw) => {
    const o = obj(raw);
    return {
      run: toRun(raw),
      annotations: asList<unknown>(o.annotations).map(toAnnotation),
    };
  });
}

export interface PagedList<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * Sunucunun sayfalama zarfını ({ items, total, page, limit, totalPages }) okur.
 * Zarf yoksa (eski/ham dizi yanıt) elenmemiş kayıt SAYISINI toplam sayar —
 * sessiz kırpma olasılığı olmadığından `hasMore` false kalır.
 */
export function readEnvelope<T>(payload: unknown, map: (raw: unknown) => T): PagedList<T> {
  const o = obj(payload);
  const items = asList<unknown>(o.items).map(map);
  const total = num(o.total) ?? items.length;
  const page = num(o.page) ?? 1;
  const limit = num(o.limit) ?? (items.length || 1);
  const totalPages = num(o.totalPages) ?? Math.max(1, Math.ceil(total / limit));
  return { items, total, page, limit, totalPages, hasMore: page < totalPages };
}

/**
 * Şerh listesi — SUNUCUDA SAYFALANMIŞ (take/skip). Yüzlerce şerhli sözleşmede
 * tek istekte hepsi ÇEKİLMEZ; "daha fazla" ile sonraki sayfa yüklenir.
 */
export function listAnnotations(
  contractId: string,
  opts: { status?: string; page?: number; limit?: number } = {},
): Promise<PagedList<ContractAnnotation>> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.annotations(contractId), {
    query: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.page ? { page: String(opts.page) } : {}),
      ...(opts.limit ? { limit: String(opts.limit) } : {}),
    },
  }).then((p) => readEnvelope(p, toAnnotation));
}

export async function runAnalysis(
  contractId: string,
  input: {
    versionId?: string;
    mode: ContractAnalysisMode;
    ourParty?: string;
    focus?: string;
  },
  piiApproved = false,
): Promise<ContractAnalysisResult> {
  const raw = await api<unknown>(CONTRACT_ANALYSIS_ROUTES.analyses(contractId), {
    method: "POST",
    body: {
      versionId: input.versionId || null,
      mode: input.mode,
      ourParty: input.ourParty?.trim() || null,
      focus: input.focus?.trim() || null,
      ...(piiApproved ? { piiApproved: true } : {}),
    },
  });
  const o = obj(raw);
  const guard = obj(o.guard);
  return {
    runId: str(o.runId) ?? "",
    contractId: str(o.contractId) ?? contractId,
    versionId: str(o.versionId) ?? null,
    versionNo: num(o.versionNo),
    mode: (str(o.mode) as ContractAnalysisResult["mode"]) ?? null,
    overallRiskScore: num(o.overallRiskScore) ?? 0,
    riskBand: (str(o.riskBand) as ContractAnalysisResult["riskBand"]) ?? null,
    ourSide: asList<unknown>(o.ourSide).map(toFinding),
    otherSide: asList<unknown>(o.otherSide).map(toFinding),
    overallNote: str(o.overallNote),
    annotations: asList<unknown>(o.annotations).map(toAnnotation),
    chunks: toChunks(o.chunks),
    chunkReports: asList<unknown>(o.chunkReports).map((raw2) => {
      const c = obj(raw2);
      return {
        index: num(c.index) ?? 0,
        pageFrom: num(c.pageFrom),
        pageTo: num(c.pageTo),
        status: (str(c.status) as "TAMAM" | "HATA") ?? "TAMAM",
        ourCount: num(c.ourCount) ?? 0,
        otherCount: num(c.otherCount) ?? 0,
        durationMs: num(c.durationMs) ?? 0,
        errorNote: str(c.errorNote),
      };
    }),
    droppedQuotes: asList<unknown>(guard.droppedQuotes).map((d) => {
      const q = obj(d);
      return {
        label: str(q.label) ?? "(bulgu)",
        perspective: str(q.perspective) ?? "",
        reasonLabel: str(q.reasonLabel),
        quote: str(q.quote),
        pageFrom: num(q.pageFrom),
        pageTo: num(q.pageTo),
      };
    }),
    model: str(o.model),
    durationMs: num(o.durationMs),
    createdAt: str(o.createdAt),
  };
}

/** Analiz tahmini — parça sayısı ve kredi (deterministik, AI'sız). */
export function getAnalysisEstimate(
  contractId: string,
  versionId?: string,
): Promise<ContractAnalysisEstimate> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.analysisEstimate(contractId), {
    query: versionId ? { versionId } : undefined,
  }).then((raw) => {
    const o = obj(raw);
    const pricing = obj(o.pricing);
    return {
      contractId: str(o.contractId) ?? contractId,
      versionId: str(o.versionId) ?? "",
      versionNo: num(o.versionNo) ?? 0,
      chars: num(o.chars) ?? 0,
      pageCount: num(o.pageCount) ?? 0,
      chunkCount: num(o.chunkCount) ?? 0,
      chunkChars: num(o.chunkChars) ?? 0,
      pricing: {
        parcaSayisi: num(pricing.parcaSayisi) ?? 0,
        parcaBasiKredi: num(pricing.parcaBasiKredi) ?? 0,
        tahminiKredi: num(pricing.tahminiKredi) ?? 0,
      },
      estimatedDurationMs: num(o.estimatedDurationMs) ?? 0,
    };
  });
}

export function closeAnnotation(
  contractId: string,
  annotationId: string,
  note: string,
): Promise<ContractAnnotation> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.closeAnnotation(contractId, annotationId), {
    method: "POST",
    body: { note },
  }).then(toAnnotation);
}

/**
 * Olay akışı — SUNUCUDA SAYFALANMIŞ: zaman çizelgesi SON N olayla açılır,
 * geçmiş "daha fazla" ile yüklenir (take/skip). Tek istekte tüm akış ÇEKİLMEZ.
 */
export function listEvents(
  contractId: string,
  opts: { page?: number; limit?: number } = {},
): Promise<PagedList<ContractEventItem>> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.events(contractId), {
    query: {
      ...(opts.page ? { page: String(opts.page) } : {}),
      ...(opts.limit ? { limit: String(opts.limit) } : {}),
    },
  }).then((p) =>
    readEnvelope(p, (raw) => {
      const o = obj(raw);
      return {
        id: str(o.id) ?? "",
        type: str(o.type) ?? "",
        detail: str(o.detail),
        actor: obj(o.actor).userId || obj(o.actor).role ? obj(o.actor) : null,
        createdAt: str(o.createdAt),
      };
    }),
  );
}

/**
 * Sürüm farkı — SAYFA PENCERELİ ve SAYFALANMIŞ: yalnızca değişen sayfaların
 * istenen dilimi döner; yüzlerce sayfalık sözleşmede diff tek yanıta tıkmaz.
 */
export function getContractDiff(
  contractId: string,
  versionAId: string,
  versionBId: string,
  opts: { page?: number; limit?: number } = {},
): Promise<ContractVersionDiffResult> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.diff(contractId), {
    query: {
      versionAId,
      versionBId,
      ...(opts.page ? { page: String(opts.page) } : {}),
      ...(opts.limit ? { limit: String(opts.limit) } : {}),
    },
  }).then((raw) => {
    const o = obj(raw);
    const counts = obj(o.counts);
    const pageCounts = obj(o.pageCounts);
    const pages = obj(o.pages);
    return {
      id: str(o.id) ?? "",
      versionA: {
        id: str(obj(o.versionA).id) ?? versionAId,
        versionNo: num(obj(o.versionA).versionNo) ?? 0,
        changeNote: str(obj(o.versionA).changeNote),
      },
      versionB: {
        id: str(obj(o.versionB).id) ?? versionBId,
        versionNo: num(obj(o.versionB).versionNo) ?? 0,
        changeNote: str(obj(o.versionB).changeNote),
      },
      counts: {
        added: num(counts.added) ?? 0,
        removed: num(counts.removed) ?? 0,
        changed: num(counts.changed) ?? 0,
      },
      pageCounts: {
        a: num(pageCounts.a),
        b: num(pageCounts.b),
      },
      unchangedPages: num(o.unchangedPages),
      pages: {
        items: asList<unknown>(pages.items).map((raw2) => {
          const p = obj(raw2);
          return {
            page: num(p.page) ?? 0,
            status: (str(p.status) as "DEGISTI" | "EKLENDI" | "SILINDI") ?? "DEGISTI",
            added: asList<unknown>(p.added)
              .map((l) => (typeof l === "string" ? l : null))
              .filter((l): l is string => l !== null),
            removed: asList<unknown>(p.removed)
              .map((l) => (typeof l === "string" ? l : null))
              .filter((l): l is string => l !== null),
            changed: asList<unknown>(p.changed).map((c) => {
              const pair = obj(c);
              return {
                before: typeof pair.before === "string" ? pair.before : "",
                after: typeof pair.after === "string" ? pair.after : "",
              };
            }),
          };
        }),
        total: num(pages.total) ?? 0,
        page: num(pages.page) ?? 1,
        limit: num(pages.limit) ?? 10,
        totalPages: num(pages.totalPages) ?? 1,
      },
      createdAt: str(o.createdAt),
    };
  });
}

export function getRiskSummary(contractId: string): Promise<ContractRiskSummary> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.riskSummary(contractId)).then((raw) => {
    const o = obj(raw);
    const last = obj(o.lastRun);
    return {
      contractId: str(o.contractId) ?? contractId,
      openAnnotations: num(o.openAnnotations) ?? 0,
      counts: obj(o.counts) as Record<string, Record<string, number>>,
      currentScore: num(o.currentScore) ?? 0,
      currentBand: (str(o.currentBand) as ContractRiskSummary["currentBand"]) ?? null,
      lastRun: last.id
        ? {
            id: str(last.id) ?? "",
            mode: str(last.mode) ?? "",
            overallRiskScore: num(last.overallRiskScore) ?? 0,
            createdAt: str(last.createdAt) ?? "",
          }
        : null,
    };
  });
}

export function notifyClient(
  contractId: string,
  note?: string,
): Promise<NotifyClientResult> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.notifyClient(contractId), {
    method: "POST",
    body: { note: note?.trim() || null },
  }).then((raw) => {
    const o = obj(raw);
    return {
      messageId: str(o.messageId) ?? "",
      contractId: str(o.contractId) ?? contractId,
      clientId: str(o.clientId),
      published: o.published === true,
      criticalCount: num(o.criticalCount) ?? 0,
      openCount: num(o.openCount) ?? 0,
      summaryPreview: str(o.summaryPreview),
      note: str(o.note),
    };
  });
}

export function getNotifyMode(contractId: string): Promise<"MANUAL" | "OTOMATIK"> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.notifySetting(contractId)).then((raw) => {
    const mode = str(obj(raw).mode);
    return mode === "OTOMATIK" ? "OTOMATIK" : "MANUAL";
  });
}

export function setNotifyMode(
  contractId: string,
  mode: "MANUAL" | "OTOMATIK",
): Promise<"MANUAL" | "OTOMATIK"> {
  return api<unknown>(CONTRACT_ANALYSIS_ROUTES.notifySetting(contractId), {
    method: "PUT",
    body: { mode },
  }).then((raw) => {
    const mode = str(obj(raw).mode);
    return mode === "OTOMATIK" ? "OTOMATIK" : "MANUAL";
  });
}

/**
 * Sürüm metni — SAYFA ARALIĞI İLE (tembel render).
 *
 * Tek istekte yüzlerce sayfa metin ÇEKİLMEZ: pencere pencere yüklenir
 * (`pageFrom`..`pageTo`), `pageCount` sayfa seçicisini kurar. Aralık
 * verilmeden çağırmak yalnızca kısa sürümlerde çalışır (sunucu tavanı
 * ~150.000 karakter; uzun sürüm 400 döner).
 */
export function getContractVersionTextPage(
  versionId: string,
  pageFrom?: number,
  pageTo?: number,
): Promise<ContractVersionTextPage> {
  return api<unknown>(`/contract-versions/${versionId}`, {
    query: {
      ...(pageFrom !== undefined ? { pageFrom: String(pageFrom) } : {}),
      ...(pageTo !== undefined ? { pageTo: String(pageTo) } : {}),
    },
  }).then((raw) => {
    const o = obj(raw);
    return {
      id: str(o.id) ?? versionId,
      versionNo: num(o.versionNo) ?? 0,
      contentText: str(o.contentText) ?? "",
      pageFrom: num(o.pageFrom) ?? 1,
      pageTo: num(o.pageTo) ?? 1,
      pageCount: num(o.pageCount) ?? 1,
      totalChars: num(o.totalChars) ?? 0,
      changeNote: str(o.changeNote),
    };
  });
}

// ------------------------------------------------------------ madde bölme

/**
 * Sözleşme metnini madde bloklarına böler.
 *
 * "Madde 7 — ..." / "MADDE 7." / "7." biçimlerinde yeni blok açılır; madde
 * dışı metin (başlık, giriş) ref'siz blokta kalır. Bölme SEZGİSELDİR:
 * numarasız başlık satırları madde bloğuna dahil edilir, şerh eşleşmesi
 * yalnız numara üzerinden yapılır.
 */
export function splitClauses(text: string): ContractClauseBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ContractClauseBlock[] = [];
  let current: ContractClauseBlock = { ref: "", number: null, text: "" };

  const pushCurrent = () => {
    const trimmed = current.text.trim();
    if (trimmed.length > 0) {
      blocks.push({ ...current, text: trimmed });
    }
  };

  for (const line of lines) {
    // "Madde 7 —", "MADDE 7.", "m.7", "7." biçimleri madde başı sayılır.
    const header = /^\s*(?:madde\s+(\d+)|m\.\s*(\d+)|(\d+)\s*[.)])/.exec(
      line.toLocaleLowerCase("tr-TR"),
    );
    const numbered = header?.[1] ?? header?.[2] ?? header?.[3];
    if (numbered !== undefined) {
      pushCurrent();
      current = { ref: `m.${numbered}`, number: Number(numbered), text: line };
    } else {
      current.text += `${current.text ? "\n" : ""}${line}`;
    }
  }
  pushCurrent();
  return blocks;
}

/**
 * Şerhi madde bloğuna bağlar: önce numara (m.7 ↔ blok 7), numara yoksa
 * şerh alıntısının blok metninde geçişi (sunucu alıntıyı zaten metinde
 * doğrulamıştır; bu yalnızca görünüm eşleşmesidir).
 */
export function annotationsForBlock(
  block: ContractClauseBlock,
  annotations: readonly ContractAnnotation[],
): ContractAnnotation[] {
  const byNumber = annotations.filter(
    (a) => block.number !== null && a.clauseRef && clauseNumberOf(a.clauseRef) === block.number,
  );
  if (byNumber.length > 0) return byNumber;
  return annotations.filter((a) => {
    if (a.quote && a.quote.trim().length >= 12 && block.text.includes(a.quote.trim().slice(0, 40))) {
      return true;
    }
    return false;
  });
}

/** "m.7" / "Madde 7" içinden madde numarasını çıkarır; sayı yoksa null. */
export function clauseNumberOf(ref: string): number | null {
  const m = /m(?:adde)?[.\s]+(\d+)/i.exec(ref.trim());
  return m ? Number(m[1]) : null;
}

/** Bloğun en ağır şerh şiddeti — kenarlık renginin kaynağı. */
export function blockSeverity(
  annotations: readonly ContractAnnotation[],
): "KRITIK" | "ORTA" | "DUSUK" | null {
  if (annotations.some((a) => a.severity === "KRITIK")) return "KRITIK";
  if (annotations.some((a) => a.severity === "ORTA")) return "ORTA";
  if (annotations.some((a) => a.severity === "DUSUK")) return "DUSUK";
  return null;
}

/** Metin içeren güncel sürüm — sürüm listesinden varsa bulunur. */
export function currentVersionOf(
  versions: readonly ContractVersionItem[],
  currentVersionId: string | null | undefined,
): ContractVersionItem | null {
  if (!versions || versions.length === 0) return null;
  return versions.find((v) => v.id === currentVersionId) ?? versions[0];
}
