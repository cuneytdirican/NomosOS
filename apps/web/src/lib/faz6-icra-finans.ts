/**
 * Faz 6 — UYAP / icra / finans istemci yardımcıları.
 *
 * Kapsam: UYAP kuyruğundan dosya oluşturma, icra portföy özeti, tebligat kayıtları,
 * zaman kronometresi + timesheet onayı, tahsilat stornosu, Luca/Logo CSV dışa aktarımı.
 * Tüm tutarlar sunucudan STRING gelir; istemci hesap yapmaz.
 */

import { API_BASE, ApiError, api } from "@/lib/api";
import { FAZ6_ROUTES } from "@nomosos/shared";

// ------------------------------------------------------------ UYAP → dosya

export interface CreateCaseFromQueueBody {
  clientId: string;
  type?: "DAVA" | "ICRA" | "CEZA" | "ARABULUCULUK" | "DANISMANLIK";
  responsibleUserId?: string | null;
  title?: string | null;
}

export interface CreateCaseFromQueueResult {
  ok: boolean;
  caseId: string;
  title: string;
  type: string;
  replayed: number;
  icraDosyasi: boolean;
}

export function createCaseFromUyapQueue(matchId: string, body: CreateCaseFromQueueBody): Promise<CreateCaseFromQueueResult> {
  return api<CreateCaseFromQueueResult>(FAZ6_ROUTES.uyapCreateCase(matchId), { method: "POST", body });
}

// ------------------------------------------------------------ icra portföyü

export interface EnforcementPortfolio {
  toplamDosya: number;
  acikDosya: number;
  asamaDagilimi: Record<string, number>;
  toplamAsilAlacak: string;
  toplamTahsilat: string;
  tahsilatOrani: number;
  vadesiGecmisSure: number;
  yaklasanSureler: Array<{ id: string; caseId: string; title: string; dueDate: string; ruleKey: string | null }>;
  para?: string;
}

export function fetchEnforcementPortfolio(): Promise<EnforcementPortfolio> {
  return api<EnforcementPortfolio>(FAZ6_ROUTES.enforcementPortfolio);
}

// ------------------------------------------------------------ tebligat

export const TEBLIGAT_KANALLARI = ["UETS", "KEP", "PTT", "ELDEN", "EPOSTA", "DIGER"] as const;
export type TebligatKanali = (typeof TEBLIGAT_KANALLARI)[number];
export const TEBLIGAT_KANAL_LABELS: Record<TebligatKanali, string> = {
  UETS: "UETS (elektronik tebligat)",
  KEP: "KEP",
  PTT: "PTT / posta",
  ELDEN: "Elden",
  EPOSTA: "E-posta",
  DIGER: "Diğer",
};

export interface Tebligat {
  id: string;
  caseId: string;
  documentId: string | null;
  channel: TebligatKanali;
  channelLabel: string;
  direction: "GELEN" | "GIDEN";
  subject: string;
  counterparty: string | null;
  sentAt: string | null;
  servedAt: string | null;
  externalRef: string | null;
  deadlineRuleKey: string | null;
  deadlineId: string | null;
  note: string | null;
  createdAt: string;
}

export interface CreateTebligatBody {
  channel: TebligatKanali;
  direction: "GELEN" | "GIDEN";
  subject: string;
  counterparty?: string | null;
  sentAt?: string | null;
  servedAt?: string | null;
  externalRef?: string | null;
  deadlineRuleKey?: string | null;
  note?: string | null;
}

/** Sunucu `{ items, saglayici }` zarfı döner; düz dizi de kabul edilir. */
export async function listTebligatlar(caseId: string): Promise<Tebligat[]> {
  const res = await api<Tebligat[] | { items?: Tebligat[] }>(FAZ6_ROUTES.tebligatlar(caseId));
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.items) ? res.items : [];
}

export function createTebligat(caseId: string, body: CreateTebligatBody): Promise<Tebligat> {
  return api<Tebligat>(FAZ6_ROUTES.tebligatlar(caseId), { method: "POST", body });
}

export function updateTebligat(id: string, body: Partial<CreateTebligatBody>): Promise<Tebligat> {
  return api<Tebligat>(FAZ6_ROUTES.tebligat(id), { method: "PATCH", body });
}

export function deleteTebligat(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(FAZ6_ROUTES.tebligat(id), { method: "DELETE" });
}

export interface TebligatSaglayiciBilgisi {
  providerKey: string;
  configured: boolean;
  note: string;
}

export function fetchTebligatSaglayici(): Promise<TebligatSaglayiciBilgisi> {
  return api<TebligatSaglayiciBilgisi>(FAZ6_ROUTES.tebligatSaglayici);
}

// ------------------------------------------------------------ kronometre + onay

export type TimerState =
  | { calisiyor: false }
  | { calisiyor: true; id: string; caseId: string | null; clientId: string | null; description: string; startedAt: string; gecenDakika: number };

export function fetchTimer(): Promise<TimerState> {
  return api<TimerState>(FAZ6_ROUTES.timer);
}

export function startTimer(body: { caseId?: string | null; clientId?: string | null; description: string }): Promise<TimerState> {
  return api<TimerState>(FAZ6_ROUTES.timerStart, { method: "POST", body });
}

export interface TimerStopResult {
  id: string;
  minutes: number;
  status: string;
  description: string;
  date: string;
  mesaj: string;
}

export function stopTimer(body: { description?: string; billable?: boolean } = {}): Promise<TimerStopResult> {
  return api<TimerStopResult>(FAZ6_ROUTES.timerStop, { method: "POST", body });
}

export function cancelTimer(): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(FAZ6_ROUTES.timer, { method: "DELETE" });
}

export const TIME_ENTRY_STATUS_LABELS: Record<string, string> = {
  TASLAK: "Taslak",
  ONAY_BEKLIYOR: "Onay bekliyor",
  ONAYLANDI: "Onaylandı",
  REDDEDILDI: "Reddedildi",
};

export function submitTimeEntry(id: string): Promise<unknown> {
  return api(FAZ6_ROUTES.timeEntrySubmit(id), { method: "POST" });
}

export function approveTimeEntry(id: string): Promise<unknown> {
  return api(FAZ6_ROUTES.timeEntryApprove(id), { method: "POST" });
}

export function rejectTimeEntry(id: string, reason: string): Promise<unknown> {
  return api(FAZ6_ROUTES.timeEntryReject(id), { method: "POST", body: { reason } });
}

export function fetchPendingTimeEntries<T>(): Promise<{ items: T[]; total: number }> {
  return api<{ items: T[]; total: number }>(FAZ6_ROUTES.timeEntriesPending);
}

// ------------------------------------------------------------ storno

export function stornoPayment(id: string, reason: string): Promise<{ ok: boolean; id: string; invoiceStatus: string | null }> {
  return api(FAZ6_ROUTES.paymentStorno(id), { method: "POST", body: { reason } });
}

// ------------------------------------------------------------ muhasebe dışa aktarımı

export type FinanceExportFormat = "luca" | "logo";

/** Luca/Logo CSV'yi indirir (kimlik httpOnly çerezle taşınır). */
export async function downloadFinanceExport(format: FinanceExportFormat, params: { from?: string; to?: string; clientId?: string } = {}): Promise<void> {
  const qs = new URLSearchParams({ format });
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.clientId) qs.set("clientId", params.clientId);
  const url = `${API_BASE}/api/v1${FAZ6_ROUTES.financeExport}?${qs.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include" });
  } catch {
    throw new ApiError("API sunucusuna ulaşılamadı.", 0, null);
  }
  if (!res.ok) {
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }
    const message = (data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : null) ?? `Dışa aktarım başarısız (HTTP ${res.status}).`;
    throw new ApiError(message, res.status, data);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `nomosos-${format}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
