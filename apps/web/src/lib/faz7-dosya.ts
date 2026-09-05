/**
 * Faz 7G — dosya detayı sekmeleri: tanık, harç, vekâletname durumu, finans özeti, kapanış listesi.
 */

import { api } from "@/lib/api";
import { CASE_TABS_ROUTES } from "@nomosos/shared";

export interface WitnessInfo {
  contact?: string | null;
  relation?: string | null;
  summonsStatus?: "BEKLIYOR" | "CELP_EDILDI" | "DINLENDI" | "VAZGECILDI" | null;
  statementSummary?: string | null;
}

export interface WitnessEvidence {
  id: string;
  title: string;
  description?: string | null;
  witnessName?: string | null;
  witnessInfo?: WitnessInfo | null;
  status: string;
  obtainedAt?: string | null;
  offeredBy?: string | null;
  createdAt?: string;
}

export const SUMMONS_LABELS: Record<string, string> = {
  BEKLIYOR: "Celp bekliyor",
  CELP_EDILDI: "Celp edildi",
  DINLENDI: "Dinlendi",
  VAZGECILDI: "Vazgeçildi",
};

export async function listWitnesses(caseId: string): Promise<WitnessEvidence[]> {
  const res = await api<{ items: WitnessEvidence[] } | WitnessEvidence[]>(CASE_TABS_ROUTES.evidence(caseId), { query: { type: "TANIK" } });
  return Array.isArray(res) ? res : res.items ?? [];
}

export function createWitness(caseId: string, body: { title: string; witnessName: string; description?: string | null; witnessInfo?: WitnessInfo | null; offeredBy?: "BIZ" | "KARSI_TARAF" }): Promise<WitnessEvidence> {
  return api(CASE_TABS_ROUTES.evidence(caseId), { method: "POST", body: { type: "TANIK", ...body } });
}

export function updateWitness(id: string, body: { witnessInfo?: WitnessInfo | null; status?: string; description?: string | null }): Promise<WitnessEvidence> {
  return api(`/evidence/${id}`, { method: "PATCH", body });
}

export interface PoaStatusView {
  hasValidPoa: boolean;
  banner: string | null;
  items: Array<{ id: string; caseId: string | null; type: string; notary: string | null; number: string | null; issuedAt: string | null; expiresAt: string | null; usable: boolean; scopedToCase: boolean; daysRemaining: number | null; scopeItems?: string[] }>;
}

export function fetchPoaStatus(caseId: string): Promise<PoaStatusView> {
  return api(CASE_TABS_ROUTES.poaStatus(caseId));
}

export interface CaseFinanceSummary {
  case: { id: string; title: string; fileNumber: string | null; status: string; client: { id: string; name: string } };
  currencies: Array<{ currency: string; accrued: string; collected: string; refunded: string; netCollected: string; outstanding: string; expenses: string }>;
  primary: { currency: string; accrued: string; collected: string; refunded: string; netCollected: string; outstanding: string; expenses: string } | null;
  time: { entryCount: number; totalMinutes: number; totalHours: string };
  entries: Array<{ id: string; type: string; amount: string; amountFormatted: string; currency: string; date: string; description: string | null; invoiceId: string | null; isBillable: boolean }>;
}

export function fetchCaseFinance(caseId: string): Promise<CaseFinanceSummary> {
  return api(CASE_TABS_ROUTES.financeSummary(caseId));
}

export interface HarcTarifesiView {
  yil: number;
  tanimli: boolean;
  mesaj: string | null;
  pesinBinde: string | null;
  istinafBinde: string | null;
  temyizBinde: string | null;
  maktuKalemler: Array<{ kod: string; ad: string; tutar: string }>;
  kaynak: string | null;
}

export function fetchHarcTarifesi(yil: number): Promise<HarcTarifesiView> {
  return api(CASE_TABS_ROUTES.harcTarifesi(yil));
}

export interface CaseExpenseRow {
  id: string;
  category: string;
  title: string;
  amount: string | number;
  spentAt: string;
  paidAt?: string | null;
  paidFrom?: string | null;
  refundable?: boolean;
}

export async function listCaseExpenses(caseId: string): Promise<CaseExpenseRow[]> {
  const res = await api<{ items?: CaseExpenseRow[]; expenses?: CaseExpenseRow[] } | CaseExpenseRow[]>(CASE_TABS_ROUTES.expenses(caseId));
  if (Array.isArray(res)) return res;
  return res.items ?? res.expenses ?? [];
}

export function createCaseExpense(caseId: string, body: { category: string; title: string; amount: number; spentAt: string; paidFrom?: "AVANS" | "BURO"; refundable?: boolean; note?: string }): Promise<CaseExpenseRow> {
  return api(CASE_TABS_ROUTES.expenses(caseId), { method: "POST", body });
}

export interface ClosingChecklistView {
  caseId: string;
  status: string;
  closedAt: string | null;
  archiveBoxNo: string | null;
  auto: Array<{ key: string; label: string; ok: boolean; count: number; hint: string }>;
  manual: Array<{ key: string; label: string; done: boolean; note: string | null; at: string | null; by: string | null }>;
  readyToClose: boolean;
  summary: string;
}

export function fetchClosingChecklist(caseId: string): Promise<ClosingChecklistView> {
  return api(CASE_TABS_ROUTES.closingChecklist(caseId));
}

export function saveClosingChecklist(caseId: string, body: { items: Array<{ key: string; done: boolean; note?: string | null }>; archiveBoxNo?: string | null }): Promise<ClosingChecklistView> {
  return api(CASE_TABS_ROUTES.closingChecklist(caseId), { method: "PUT", body });
}
