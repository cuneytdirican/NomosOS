/**
 * Faz 4 API istemcisi — Strateji, Simülasyon, Risk, Delil, Bilirkişi, Çakışma.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ UÇ SÖZLEŞMESİ: yollar `docs/moduller/{11,13,14,15,16,17}-*.md` içindeki  ║
 * ║ "API Uçları" tablolarından alınmıştır ve `/api/v1` ÖNEKSİZ yazılır       ║
 * ║ (önek `lib/api.ts` içindeki `api()` yardımcısındadır).                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * YEDEK YOL YOKTUR (Faz 2 dersi): tek bir uç denenir, meşru 404'ler ("Dosya
 * bulunamadı") olduğu gibi gösterilir. TEK İSTİSNA `riskOffice()` içinde
 * belgelenmiştir: iki kaynak (görev tanımı ve modül şartnamesi) farklı yol
 * verdiği için orada iki aday sırayla denenir.
 *
 * API'ler bu turda paralel yazıldığından, uç henüz YAYINDA DEĞİLSE (gövdesiz
 * 404 / ağ yok) çağıranlar `isFeatureMissing()` ile "Bu özellik henüz hazır
 * değil" ekranına düşer — sayfa çökmez.
 */

import { ApiError, api, asList } from "@/lib/api";
import { isMissingEndpoint } from "@/lib/faz2";
import type {
  CaseRisk,
  Claim,
  ClaimEvidenceLink,
  ConflictCheck,
  Evidence,
  EvidenceGap,
  EvidenceMatrix,
  EvidenceSuggestion,
  Expert,
  ExpertReport,
  ExpertReportDiff,
  ExpertReportPatchResult,
  ObjectionDraft,
  RiskCaseRow,
  RiskScore,
  RiskSignal,
  SimFinding,
  SimulationRun,
  SourceRef,
  Strategy,
  StrategyNode,
  StrategyVersion,
} from "./faz4-types";

// ------------------------------------------------------------ yol tablosu

export const FAZ4_ROUTES = {
  // Strateji (Modül 15)
  strategy: (caseId: string) => `/cases/${caseId}/strategy`,
  strategyBuild: (caseId: string) => `/cases/${caseId}/strategy/build`,
  strategyVersions: (strategyId: string) => `/strategies/${strategyId}/versions`,
  strategyNodes: (strategyId: string) => `/strategies/${strategyId}/nodes`,
  strategyNode: (strategyId: string, nodeId: string) =>
    `/strategies/${strategyId}/nodes/${nodeId}`,

  // Simülasyon (Modül 16) — POST ucunun adı /simulate'dir; /simulations YALNIZ listeledir.
  simulate: (caseId: string) => `/cases/${caseId}/simulate`,
  simulations: (caseId: string) => `/cases/${caseId}/simulations`,
  simulation: (runId: string) => `/simulations/${runId}`,

  // Risk (Modül 17)
  risk: (caseId: string) => `/cases/${caseId}/risk`,
  riskRecompute: (caseId: string) => `/cases/${caseId}/risk/recompute`,
  riskOverride: (caseId: string, dimension: string) =>
    `/cases/${caseId}/risk/${dimension}/override`,
  riskOfficePrimary: "/risk/office",
  riskOfficeAlternate: "/risk/cases",

  // Delil (Modül 14)
  claims: (caseId: string) => `/cases/${caseId}/claims`,
  claim: (claimId: string) => `/claims/${claimId}`,
  claimEvidenceLinks: (claimId: string) => `/claims/${claimId}/evidence`,
  claimEvidenceLink: (claimId: string, evidenceId: string) =>
    `/claims/${claimId}/evidence/${evidenceId}`,
  claimLegalBasis: (claimId: string) => `/claims/${claimId}/legal-basis`,
  evidenceList: (caseId: string) => `/cases/${caseId}/evidence`,
  evidence: (evidenceId: string) => `/evidence/${evidenceId}`,
  evidenceAiMatrix: (caseId: string) => `/cases/${caseId}/evidence/matrix/ai-generate`,
  evidenceGapAnalysis: (caseId: string) => `/cases/${caseId}/evidence/gap-analysis`,

  // Bilirkişi (Modül 13)
  expertReports: (caseId: string) => `/cases/${caseId}/expert-reports`,
  expertReport: (reportId: string) => `/expert-reports/${reportId}`,
  expertObjections: (reportId: string) => `/expert-reports/${reportId}/objections`,
  expertObjectionDraft: (reportId: string) => `/expert-reports/${reportId}/objection-draft`,
  expertCompare: (caseId: string) => `/cases/${caseId}/experts/compare`,
  experts: "/experts",

  // Çakışma (Modül 11)
  conflictChecks: "/conflict-checks",
  conflictCheck: (id: string) => `/conflict-checks/${id}`,
  conflictQuick: "/conflict-checks/quick",
  conflictDecide: (id: string) => `/conflict-checks/${id}/decide`,
} as const;

/** Uç henüz yayında değil mi? (gövdesiz 404 / 405 / 501 ya da ağ kopukluğu) */
export function isFeatureMissing(err: unknown): boolean {
  return isMissingEndpoint(err);
}

/** Ağ değil, yalnızca "böyle bir uç yok" durumu — yedek aday denemeye değer. */
function isBareNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status !== 0 && isMissingEndpoint(err);
}

// ------------------------------------------------------------ yardımcılar

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** JSON alanları bazen düz metin olarak gelir; ikisini de nesneye indirger. */
function parsed(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => str(v)).filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  return null;
}

/** Nesnedeki ilk dizi alanı — mod şeması tanınmadığında son çare. */
function firstArray(source: Record<string, unknown>): unknown[] {
  for (const value of Object.values(source)) {
    if (Array.isArray(value) && value.length > 0) return value;
    // İÇ İÇE: sarmalayıcı {result: {arguments: [...]}} — ilk seviye nesne
    // değerlerinin içinde de dizi ara (mod verisi orada yaşar).
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = firstArray(value as Record<string, unknown>);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function sourceRefsOf(value: unknown): SourceRef[] {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((r): SourceRef => {
    if (typeof r === "string") return { label: r };
    const o = obj(r);
    return {
      documentId: str(o.documentId ?? o.document_id),
      documentName: str(o.documentName ?? o.document_name ?? o.name),
      locator: str(o.locator ?? o.page ?? o.paragraph),
      quote: str(o.quote ?? o.alinti),
      label: str(o.label),
    };
  });
}

function citationsOf(value: unknown): Array<{ ref?: string; kind?: string; verified?: boolean }> {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((c) => {
    if (typeof c === "string") return { ref: c, verified: false };
    const o = obj(c);
    return {
      ref: str(o.ref ?? o.raw ?? o.citation) ?? undefined,
      kind: str(o.kind) ?? undefined,
      verified: typeof o.verified === "boolean" ? o.verified : false,
    };
  });
}

// ------------------------------------------------------------------ strateji

export async function getStrategy(caseId: string): Promise<Strategy | null> {
  const res = await api<unknown>(FAZ4_ROUTES.strategy(caseId));
  if (!res) return null;
  const o = obj(res);
  // Uç "aktif strateji yok" durumunu boş nesne ya da { strategy: null } ile
  // bildirebilir; ikisi de "henüz strateji üretilmedi" demektir.
  if (o.strategy !== undefined) return (o.strategy as Strategy | null) ?? null;
  if (!o.id) return null;
  return res as Strategy;
}

/** STRATEGY_BUILD — AI taslağı üretir. Sonuç ÖNERİDİR, TASLAK statüsünde doğar. */
export function buildStrategy(
  caseId: string,
  instruction?: string,
  piiApproved = false,
): Promise<Strategy> {
  const body: Record<string, unknown> = {};
  if (instruction?.trim()) body.instruction = instruction.trim();
  if (piiApproved) body.piiApproved = true;
  return api<Strategy>(FAZ4_ROUTES.strategyBuild(caseId), { method: "POST", body });
}

export function listStrategyVersions(strategyId: string): Promise<StrategyVersion[]> {
  return api<unknown>(FAZ4_ROUTES.strategyVersions(strategyId)).then((p) =>
    asList<StrategyVersion>(p),
  );
}

export function createStrategyNode(
  strategyId: string,
  body: { nodeType: string; content: string; strength?: string; sourceRef?: string; parentId?: string },
): Promise<StrategyNode> {
  return api<StrategyNode>(FAZ4_ROUTES.strategyNodes(strategyId), { method: "POST", body });
}

export function updateStrategyNode(
  strategyId: string,
  nodeId: string,
  body: { content?: string; strength?: string | null; sourceRef?: string | null },
): Promise<StrategyNode> {
  return api<StrategyNode>(FAZ4_ROUTES.strategyNode(strategyId, nodeId), {
    method: "PATCH",
    body,
  });
}

export function deleteStrategyNode(strategyId: string, nodeId: string): Promise<unknown> {
  return api<unknown>(FAZ4_ROUTES.strategyNode(strategyId, nodeId), { method: "DELETE" });
}

/**
 * Ağacın düz düğüm listesi.
 *
 * Gerçek kaynak `StrategyVersion.treeJson`; `StrategyNode` tablosu ondan
 * türetilen sorgulanabilir kopyadır (bkz. hazırlık raporu, madde 11). Bu yüzden
 * önce normalize tablo okunur; yoksa `treeJson` düzleştirilir.
 */
export function strategyNodesOf(strategy: Strategy | null | undefined): StrategyNode[] {
  if (!strategy) return [];
  if (Array.isArray(strategy.nodes) && strategy.nodes.length > 0) {
    return [...strategy.nodes].sort(
      (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
    );
  }
  const tree = parsed(strategy.currentVersion?.treeJson);
  const nodes = obj(tree).nodes;
  return flattenTree(Array.isArray(nodes) ? nodes : []);
}

function flattenTree(raw: unknown[], parentId: string | null = null): StrategyNode[] {
  const out: StrategyNode[] = [];
  raw.forEach((item, index) => {
    const o = obj(item);
    const id = str(o.id) ?? `${parentId ?? "kok"}-${index}`;
    const node: StrategyNode = {
      id,
      parentId,
      nodeType: str(o.nodeType ?? o.node_type ?? o.type) ?? "RISK",
      content: str(o.content ?? o.title ?? o.body ?? o.text) ?? "(boş düğüm)",
      strength:
        typeof o.strength === "number"
          ? o.strength
          : str(o.strength ?? o.strength_1_10) ?? null,
      sourceRef: str(o.sourceRef ?? o.source_ref ?? o.basis) ?? null,
      orderIndex: typeof o.sort_order === "number" ? o.sort_order : index,
    };
    out.push(node);
    const children = o.children;
    if (Array.isArray(children)) out.push(...flattenTree(children, id));
  });
  return out;
}

// ---------------------------------------------------------------- simülasyon

export function listSimulations(caseId: string): Promise<SimulationRun[]> {
  return api<unknown>(FAZ4_ROUTES.simulations(caseId)).then((p) => asList<SimulationRun>(p));
}

export function runSimulation(
  caseId: string,
  mode: string,
  params: Record<string, unknown> = {},
  piiApproved = false,
): Promise<SimulationRun> {
  // Sunucu şeması (simulation.dto.ts) gövdede EN ÜST DÜZEYDE alan bekler:
  // { mode, question?, documentId?, argumentCount?, piiApproved? } — "params"
  // zarfı YOKTUR. Eski çağrı { params: {...} } gönderiyor ve Zod bilinmeyen
  // anahtarı sessizce attığı için mod parametreleri sunucuya HİÇ gitmiyordu.
  const body: Record<string, unknown> = { mode };
  if (typeof params.question === "string") body.question = params.question;
  if (typeof params.argumentCount === "number") body.argumentCount = params.argumentCount;
  // Eski isim uyumluluğu: target_document_id → documentId.
  const docId =
    params.documentId ?? params.target_document_id ?? params.targetDocumentId;
  if (typeof docId === "string" && docId) body.documentId = docId;
  if (piiApproved) body.piiApproved = true;
  // POST ucu /simulate'dir — /simulations GET listesidir (404 hatasının kaynağı buydu).
  return api<SimulationRun>(FAZ4_ROUTES.simulate(caseId), { method: "POST", body });
}

export function getSimulation(runId: string): Promise<SimulationRun> {
  return api<SimulationRun>(FAZ4_ROUTES.simulation(runId));
}

export function simulationOutput(run: SimulationRun | null | undefined): Record<string, unknown> {
  if (!run) return {};
  // SÖZLEŞME (AUDIT A2): liste ve detay uçları parse edilmiş `output` NESNESİ
  // döner; eski kayıtlar/akışlar dize `outputJson` da taşıyabilir. Önce nesne.
  const out = (run as unknown as { output?: unknown }).output;
  if (out !== undefined && out !== null) return obj(out);
  return obj(parsed(run.outputJson));
}

/**
 * Modun ASIL çıktısı — sunucu `outputJson`'ı {result: {...}} SARMALAYICISIYLA
 * saklar (simulation.service.ts: output = { result: run.data, ... }).
 * Bu yardımcı sarmalayıcıyı çözer: {result} varken üst düzey alanlar
 * (droppedFindings) korunur, mod verisi result içinden okunur.
 */
export function simulationResultData(run: SimulationRun | null | undefined): Record<string, unknown> {
  const out = simulationOutput(run);
  const inner = obj(out.result);
  // Sarmalayıcı var mı? result bir nesne VEYA mod çıktısı doğrudan üstte olabilir.
  if (Object.keys(inner).length > 0) return inner;
  return out;
}

/** HAKIM_GOZU modunun genel eğilimi (varsa) — çıktı kartında şerit olarak gösterilir. */
export function simulationLeaning(run: SimulationRun | null | undefined): string | null {
  const data = simulationResultData(run);
  return str(data.overall_leaning ?? data.overallLeaning ?? data.genel_egilim);
}

/**
 * Modelin genel değerlendirmesi (KARSI_TARAF_AVUKATI: overallAssessment) —
 * bulgu ÇIKMAYINCA boş koşunun NEDEN boş kaldığını açıklayan dürüst metindir.
 * Boş liste + açıklama, savunma hattının beklenen davranışıdır (kaynak yoksa
 * uydurma argüman ÜRETİLMEZ); açıklama ekranda görünmelidir.
 */
export function simulationAssessment(run: SimulationRun | null | undefined): string | null {
  const data = simulationResultData(run);
  return str(
    data.overallAssessment ?? data.overall_assessment ?? data.genel_degerlendirme,
  );
}

/**
 * Mod çıktısını ekranda gezilebilir "bulgu" listesine indirger.
 *
 * Her modun kendi JSON şeması vardır (Modül 16). Şema tanınmazsa nesnedeki ilk
 * dizi alanı jenerik biçimde listelenir — böylece sözleşme değişse bile ekran
 * boş kalmaz, yalnızca daha sade görünür.
 */
export function simulationFindings(run: SimulationRun | null | undefined): SimFinding[] {
  if (!run) return [];
  // Sarmalayıcı çözülmüş mod verisi (bkz. simulationResultData).
  const out = simulationResultData(run);
  const mode = String(run.mode ?? "");

  const push = (
    items: unknown[],
    map: (o: Record<string, unknown>, i: number) => Omit<SimFinding, "key">,
  ): SimFinding[] =>
    items.map((item, i) => {
      const o = obj(item);
      const base = map(o, i);
      return {
        ...base,
        key: `${mode}-${i}`,
        fields: base.fields.filter((f) => f.value.trim().length > 0),
      };
    });

  if (mode === "KARSI_TARAF_AVUKATI") {
    const items = Array.isArray(out.arguments) ? out.arguments : firstArray(out);
    return push(items, (o, i) => ({
      rank: typeof o.rank === "number" ? o.rank : i + 1,
      title: str(o.title) ?? "Argüman",
      severity: str(o.strength_1_10 ?? o.strength),
      fields: [
        { label: "Hukuki dayanak", value: str(o.basis) ?? "" },
        { label: "Bizim açığımız", value: str(o.our_gap ?? o.ourGap) ?? "" },
        { label: "Önerilen cevabımız", value: str(o.suggested_reply ?? o.suggestedReply) ?? "" },
      ],
      sourceRefs: sourceRefsOf(o.source_refs ?? o.sourceRefs),
      citations: citationsOf(o.citations),
    }));
  }

  if (mode === "HAKIM_GOZU") {
    const procedural = Array.isArray(out.procedural_issues) ? out.procedural_issues : [];
    const merits = Array.isArray(out.merits_assessment) ? out.merits_assessment : [];
    const missing = Array.isArray(out.missing_elements) ? out.missing_elements : [];
    const findings: SimFinding[] = [];

    procedural.forEach((item, i) => {
      const o = typeof item === "string" ? { issue: item } : obj(item);
      findings.push({
        key: `usul-${i}`,
        title: str(o.issue ?? o.title) ?? "Usul tespiti",
        severity: "USUL",
        fields: [
          { label: "Değerlendirme", value: str(o.likely_view ?? o.assessment) ?? "" },
          { label: "Gerekçe", value: str(o.reasoning ?? o.note) ?? "" },
        ].filter((f) => f.value.length > 0),
        sourceRefs: sourceRefsOf(o.source_refs ?? o.sourceRefs),
      });
    });

    merits.forEach((item, i) => {
      const o = obj(item);
      findings.push({
        key: `esas-${i}`,
        title: str(o.issue ?? o.title) ?? "Esas tespiti",
        severity: "ESAS",
        fields: [
          { label: "Muhtemel değerlendirme", value: str(o.likely_view ?? o.likelyView) ?? "" },
          { label: "Gerekçe", value: str(o.reasoning) ?? "" },
        ].filter((f) => f.value.length > 0),
        sourceRefs: sourceRefsOf(o.source_refs ?? o.sourceRefs),
      });
    });

    if (missing.length > 0) {
      findings.push({
        key: "eksik",
        title: "Hakimin eksik gördüğü hususlar",
        severity: "EKSIK",
        fields: missing.map((m, i) => ({ label: `${i + 1}.`, value: str(m) ?? "" })),
      });
    }
    return findings;
  }

  if (mode === "KAYBETTIREN_HUSUSLAR") {
    const items = Array.isArray(out.factors) ? out.factors : firstArray(out);
    return push(items, (o, i) => ({
      rank: i + 1,
      title: str(o.title) ?? "Risk unsuru",
      severity: str(o.likelihood ?? o.severity),
      fields: [
        { label: "Neden", value: str(o.why ?? o.reason) ?? "" },
        { label: "Önlem önerisi", value: str(o.mitigation) ?? "" },
        { label: "İlgili süre", value: str(o.related_deadline ?? o.relatedDeadline) ?? "" },
      ],
      sourceRefs: sourceRefsOf(o.source_refs ?? o.sourceRefs),
    }));
  }

  if (mode === "KARSI_DILEKCE_ZAYIFLIK") {
    const items = Array.isArray(out.weaknesses) ? out.weaknesses : firstArray(out);
    return push(items, (o, i) => ({
      rank: i + 1,
      title: str(o.weakness_type ?? o.weaknessType ?? o.title) ?? "Zayıflık",
      severity: str(o.weakness_type ?? o.weaknessType),
      quote: str(o.quote),
      fields: [
        { label: "Nerede", value: str(o.locator) ?? "" },
        {
          label: "Nasıl kullanılır",
          value: str(o.exploit_suggestion ?? o.exploitSuggestion) ?? "",
        },
      ],
      sourceRefs: sourceRefsOf(o.source_refs ?? o.sourceRefs),
    }));
  }

  if (mode === "BILIRKISI_ODAGI") {
    const items = Array.isArray(out.focus_points) ? out.focus_points : firstArray(out);
    return push(items, (o, i) => ({
      rank: i + 1,
      title: str(o.topic ?? o.title) ?? "Odak noktası",
      severity: str(o.our_evidence_state ?? o.ourEvidenceState),
      fields: [
        {
          label: "Bilirkişi neden ilgilenir",
          value: str(o.why_expert_cares ?? o.whyExpertCares) ?? "",
        },
        { label: "Hazırlık aksiyonu", value: str(o.prep_action ?? o.prepAction) ?? "" },
      ],
      sourceRefs: sourceRefsOf(o.source_refs ?? o.sourceRefs),
    }));
  }

  // Tanınmayan şema — nesnedeki ilk diziyi jenerik listele.
  return push(firstArray(out), (o, i) => ({
    rank: i + 1,
    title: str(o.title ?? o.topic ?? o.issue) ?? `Bulgu ${i + 1}`,
    fields: Object.entries(o)
      .filter(([key]) => !["title", "topic", "issue", "rank"].includes(key))
      .map(([key, value]) => ({ label: key, value: str(value) ?? "" })),
  }));
}

// --------------------------------------------------------------------- risk

export async function getCaseRisk(caseId: string): Promise<CaseRisk> {
  const res = await api<unknown>(FAZ4_ROUTES.risk(caseId));
  const o = obj(res);
  const scores = asList<RiskScore>(
    Array.isArray(res) ? res : (o.scores ?? o.dimensions ?? o.items ?? []),
  );
  return {
    caseId,
    scores,
    overrides: asList(o.overrides ?? []),
    computedAt: str(o.computedAt),
  };
}

export function recomputeRisk(caseId: string, piiApproved = false): Promise<unknown> {
  return api<unknown>(FAZ4_ROUTES.riskRecompute(caseId), {
    method: "POST",
    body: piiApproved ? { piiApproved: true } : {},
  });
}

/** Elle ezme — GEREKÇE ZORUNLUDUR (şemada `reason` nullable değildir). */
export function overrideRiskBand(
  caseId: string,
  dimension: string,
  band: string,
  reason: string,
): Promise<unknown> {
  return api<unknown>(FAZ4_ROUTES.riskOverride(caseId, dimension), {
    method: "POST",
    body: { band, reason: reason.trim() },
  });
}

export function clearRiskOverride(caseId: string, dimension: string): Promise<unknown> {
  return api<unknown>(FAZ4_ROUTES.riskOverride(caseId, dimension), { method: "DELETE" });
}

/**
 * Büro geneli riskli dosya listesi.
 *
 * İKİ ADAY YOL: görev tanımı `/risk/office`, Modül 17 şartnamesi `/risk/cases`
 * diyor. Sözleşme sabitlenene kadar önce birincisi denenir; YALNIZCA gövdesiz
 * 404/405/501 durumunda ikincisi denenir (meşru hatalar ve ağ kopukluğu olduğu
 * gibi yükselir). Uç sabitlendiğinde bu yardımcıdaki ikinci deneme silinmelidir.
 */
export async function riskOffice(query: {
  band?: string;
  dimension?: string;
  limit?: number;
}): Promise<RiskCaseRow[]> {
  const params = {
    band: query.band || undefined,
    dimension: query.dimension || undefined,
    limit: query.limit,
  };
  try {
    return asList<RiskCaseRow>(
      await api<unknown>(FAZ4_ROUTES.riskOfficePrimary, { query: params }),
    );
  } catch (err) {
    if (!isBareNotFound(err)) throw err;
    return asList<RiskCaseRow>(
      await api<unknown>(FAZ4_ROUTES.riskOfficeAlternate, { query: params }),
    );
  }
}

/** Kural sinyalleri — dizi ya da `{ signals: [...] }` biçiminde gelebilir. */
export function riskSignals(score: RiskScore | null | undefined): RiskSignal[] {
  if (!score) return [];
  const raw = parsed(score.ruleSignalsJson);
  const list = Array.isArray(raw) ? raw : obj(raw).signals;
  if (!Array.isArray(list)) return [];
  return list.map((item): RiskSignal => {
    if (typeof item === "string") return { source: "KURAL", reason: item };
    const o = obj(item);
    return {
      source: str(o.source) ?? "KURAL",
      code: str(o.code),
      points: typeof o.points === "number" ? o.points : null,
      reason: str(o.reason ?? o.note ?? o.description),
      refs: o.refs,
    };
  });
}

export function findScore(
  risk: CaseRisk | null | undefined,
  dimension: string,
): RiskScore | null {
  return risk?.scores.find((s) => s.dimension === dimension) ?? null;
}

// -------------------------------------------------------------------- delil

export function listClaims(caseId: string): Promise<Claim[]> {
  return api<unknown>(FAZ4_ROUTES.claims(caseId)).then((p) => asList<Claim>(p));
}

export function listEvidence(caseId: string): Promise<Evidence[]> {
  return api<unknown>(FAZ4_ROUTES.evidenceList(caseId)).then((p) => asList<Evidence>(p));
}

export function createClaim(
  caseId: string,
  body: { side: string; text: string; status?: string },
): Promise<Claim> {
  return api<Claim>(FAZ4_ROUTES.claims(caseId), { method: "POST", body });
}

export function updateClaim(
  claimId: string,
  body: { text?: string; status?: string; side?: string },
): Promise<Claim> {
  return api<Claim>(FAZ4_ROUTES.claim(claimId), { method: "PATCH", body });
}

export function createEvidence(
  caseId: string,
  body: {
    type: string;
    title: string;
    description?: string;
    witnessName?: string;
    documentId?: string;
    obtainedAt?: string;
    status?: string;
    /** Delili kim sundu (F2 · E6): BIZ · KARSI_TARAF · ORTAK. */
    offeredBy?: string;
  },
): Promise<Evidence> {
  return api<Evidence>(FAZ4_ROUTES.evidenceList(caseId), { method: "POST", body });
}

export function linkClaimEvidence(
  claimId: string,
  body: {
    evidenceId: string;
    /** 1-5 arası tamsayı — sunucu şeması z.number().int() ister. */
    strength?: number;
    /** Bağın YÖNÜ (F2 · E6): SUPPORTS · CONTRADICTS · BELIRSIZ. */
    linkType?: string;
    note?: string;
  },
): Promise<ClaimEvidenceLink> {
  // Uç sözleşmesi: evidenceId YOLDA taşınır (POST /claims/:id/evidence/:evidenceId),
  // gövdede yalnız strength/linkType/note var.
  const { evidenceId, ...rest } = body;
  return api<ClaimEvidenceLink>(FAZ4_ROUTES.claimEvidenceLink(claimId, evidenceId), {
    method: "POST",
    body: rest,
  });
}

export function unlinkClaimEvidence(claimId: string, evidenceId: string): Promise<unknown> {
  return api<unknown>(FAZ4_ROUTES.claimEvidenceLink(claimId, evidenceId), { method: "DELETE" });
}

export function addLegalBasis(
  claimId: string,
  body: { reference: string; note?: string; caseLawId?: string },
): Promise<unknown> {
  return api<unknown>(FAZ4_ROUTES.claimLegalBasis(claimId), { method: "POST", body });
}

/**
 * Matris İSTEMCİDE birleştirilir.
 *
 * Ayrı bir `/matrix` ucuna bağlanmak yerine iddia ve delil listeleri okunup
 * bağlar burada indekslenir: tek bir uç sözleşmesi eksilir ve matris, listelerin
 * kendisiyle DAİMA tutarlı kalır.
 */
export function buildMatrix(claims: Claim[], evidences: Evidence[]): EvidenceMatrix {
  const linkIndex = new Map<string, ClaimEvidenceLink>();
  for (const claim of claims) {
    for (const link of claim.evidenceLinks ?? []) {
      linkIndex.set(`${claim.id}::${link.evidenceId}`, link);
    }
  }
  // Bağlar delil tarafında geldiyse (claimLinks) onları da indeksle.
  for (const ev of evidences) {
    for (const link of ev.claimLinks ?? []) {
      const key = `${link.claimId}::${ev.id}`;
      if (!linkIndex.has(key)) linkIndex.set(key, link);
    }
  }
  return {
    claims: [...claims].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
    evidences,
    linkIndex,
  };
}

/** EVIDENCE_MATRIX — AI matris ÖNERİSİ. Kayda geçmez, tek tek eklenir. */
export function aiEvidenceMatrix(
  caseId: string,
  piiApproved = false,
): Promise<EvidenceSuggestion[]> {
  return api<unknown>(FAZ4_ROUTES.evidenceAiMatrix(caseId), {
    method: "POST",
    body: piiApproved ? { piiApproved: true } : {},
  }).then((res) => {
    const o = obj(res);
    const raw = Array.isArray(res)
      ? res
      : (o.suggestions ?? o.items ?? o.proposals ?? firstArray(o));
    return asList<EvidenceSuggestion>(raw);
  });
}

/** EVIDENCE_GAP — desteksiz / zayıf iddia raporu. Salt okunur öneridir. */
export function aiEvidenceGaps(caseId: string, piiApproved = false): Promise<EvidenceGap[]> {
  return api<unknown>(FAZ4_ROUTES.evidenceGapAnalysis(caseId), {
    method: "POST",
    body: piiApproved ? { piiApproved: true } : {},
  }).then((res) => {
    const o = obj(res);
    const raw = Array.isArray(res) ? res : (o.gaps ?? o.items ?? firstArray(o));
    return asList<EvidenceGap>(raw);
  });
}

// ---------------------------------------------------------------- bilirkişi

export function listExpertReports(caseId: string): Promise<ExpertReport[]> {
  return api<unknown>(FAZ4_ROUTES.expertReports(caseId)).then((p) => asList<ExpertReport>(p));
}

export function listExperts(): Promise<Expert[]> {
  return api<unknown>(FAZ4_ROUTES.experts).then((p) => asList<Expert>(p));
}

export function createExpertReport(
  caseId: string,
  body: {
    reportType: string;
    receivedAt: string;
    servedAt?: string;
    expertId?: string;
    documentId?: string;
    summary?: string;
    conclusionText?: string;
  },
): Promise<ExpertReportPatchResult> {
  // Sunucu servedAt verildiyse `deadline` önerisiyle döner (expert.service.ts:283).
  return api<ExpertReportPatchResult>(FAZ4_ROUTES.expertReports(caseId), {
    method: "POST",
    body,
  });
}

/**
 * Tebliğ tarihi girişi.
 *
 * SÜRE HESABI SUNUCUDADIR: itiraz süresi (HMK m.281) deterministik süre
 * motorunun işidir; tarayıcı gün saymaz. Sunucu bir `deadlineSuggestion`
 * döndürürse ekranda ÖNERİ olarak gösterilir, kaydı avukat oluşturur.
 */
export function setExpertReportServedAt(
  reportId: string,
  servedAt: string,
): Promise<ExpertReportPatchResult> {
  return api<ExpertReportPatchResult>(FAZ4_ROUTES.expertReport(reportId), {
    method: "PATCH",
    body: { servedAt },
  });
}

export function compareExpertReports(
  caseId: string,
  baseReportId: string,
  compareReportId: string,
  piiApproved = false,
): Promise<ExpertReportDiff> {
  const body: Record<string, unknown> = { baseReportId, compareReportId };
  if (piiApproved) body.piiApproved = true;
  return api<ExpertReportDiff>(FAZ4_ROUTES.expertCompare(caseId), { method: "POST", body });
}

/** Fark tablosu satırları — `diffJson` dizi ya da `{ items: [...] }` olabilir. */
export function expertDiffItems(diff: ExpertReportDiff | null | undefined) {
  if (!diff) return [];
  if (Array.isArray(diff.items) && diff.items.length > 0) return diff.items;
  const raw = parsed(diff.diffJson);
  const list = Array.isArray(raw) ? raw : (obj(raw).items ?? obj(raw).differences ?? []);
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const o = obj(item);
    return {
      topic: str(o.topic ?? o.konu ?? o.subject),
      baseFinding: str(o.baseFinding ?? o.base ?? o.baseText),
      compareFinding: str(o.compareFinding ?? o.compare ?? o.compareText),
      baseQuote: str(o.baseQuote ?? o.baseAlinti),
      compareQuote: str(o.compareQuote ?? o.compareAlinti),
      direction: str(o.direction ?? o.yon),
      note: str(o.note ?? o.not),
    };
  });
}

export function draftExpertObjection(
  reportId: string,
  instruction?: string,
  piiApproved = false,
): Promise<ObjectionDraft> {
  const body: Record<string, unknown> = {};
  if (instruction?.trim()) body.instruction = instruction.trim();
  if (piiApproved) body.piiApproved = true;
  return api<ObjectionDraft>(FAZ4_ROUTES.expertObjectionDraft(reportId), {
    method: "POST",
    body,
  });
}

export function saveExpertObjection(
  reportId: string,
  points: string,
): Promise<unknown> {
  return api<unknown>(FAZ4_ROUTES.expertObjections(reportId), {
    method: "POST",
    body: { points: points.trim() },
  });
}

export function objectionDraftText(draft: ObjectionDraft | null | undefined): string {
  if (!draft) return "";
  const o = obj(draft);
  return (
    str(o.points ?? o.draft ?? o.text ?? o.body ?? o.summary) ??
    ""
  );
}

// ----------------------------------------------------------------- çakışma

export function runConflictCheck(query: string, context?: string): Promise<ConflictCheck> {
  const body: Record<string, unknown> = { query: query.trim() };
  if (context?.trim()) body.context = context.trim();
  return api<ConflictCheck>(FAZ4_ROUTES.conflictChecks, { method: "POST", body });
}

/**
 * Ön tarama — KAYIT AÇMAZ.
 *
 * Yeni müvekkil formunda ad yazılırken çağrılır; sonucu yalnızca uyarı kartı
 * besler. Hata ASLA yükseltilmez: çatışma taraması müvekkil kaydını
 * ENGELLEMEZ (Modül 11, iş kuralı 1) — tarama çalışmazsa form akışı sürer.
 */
export async function quickConflictCheck(query: string): Promise<ConflictCheck | null> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return null;
  try {
    return await api<ConflictCheck>(FAZ4_ROUTES.conflictQuick, {
      method: "POST",
      body: { query: trimmed },
    });
  } catch {
    return null;
  }
}

export function listConflictChecks(limit = 50): Promise<ConflictCheck[]> {
  return api<unknown>(FAZ4_ROUTES.conflictChecks, { query: { limit } }).then((p) =>
    asList<ConflictCheck>(p),
  );
}

export function getConflictCheck(id: string): Promise<ConflictCheck> {
  return api<ConflictCheck>(FAZ4_ROUTES.conflictCheck(id));
}

/** Karar kaydı — gerekçe notu serbesttir ama karar DAİMA insanındır. */
export function decideConflictCheck(
  id: string,
  decision: string,
  decisionNote?: string,
): Promise<ConflictCheck> {
  const body: Record<string, unknown> = { decision };
  if (decisionNote?.trim()) body.decisionNote = decisionNote.trim();
  return api<ConflictCheck>(FAZ4_ROUTES.conflictDecide(id), { method: "POST", body });
}

export function conflictHits(check: ConflictCheck | null | undefined) {
  return check?.hits ?? [];
}
