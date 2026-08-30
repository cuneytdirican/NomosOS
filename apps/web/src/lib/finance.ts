/**
 * Finans modülü API istemcisi — `/api/v1/finance/**` (Modül 08).
 *
 * SÖZLEŞME:
 *   GET/POST /finance/entries                  — hareket listesi / oluşturma
 *   GET      /finance/clients/:clientId/summary — müvekkil finans özeti
 *   GET      /finance/cases/:caseId/summary     — dosya finans özeti
 *   GET      /finance/reports/office            — büro geneli rapor (dönem parametreli)
 *   GET      /finance/reports/aging             — yaşlandırma (0-30/31-60/61-90/90+)
 *
 * PARA İLKESİ: bu dosya HİÇBİR toplam hesaplamaz. Tahakkuk, tahsilat, bekleyen
 * bakiye, yaşlandırma kovaları ve avans bakiyesi SUNUCUDAN gelir. Sunucu bir
 * alanı göndermiyorsa arayüz "—" gösterir; eksik veriyi sıfır sanıp toplamaz.
 */

import { api, asList } from "@/lib/api";
import { isMissingEndpoint } from "@/lib/faz2";
import type {
  AgingBucket,
  ClientFinanceSummary,
  FinanceEntry,
  FinancialEntryType,
  OfficeFinanceReport,
  TopDebtor,
} from "@/lib/faz3-types";

// ----------------------------------------------------------------- hareketler

export interface FinanceEntryQuery {
  clientId?: string;
  caseId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export function listFinanceEntries(query: FinanceEntryQuery = {}): Promise<FinanceEntry[]> {
  return api<unknown>("/finance/entries", { query: { ...query } }).then((p) =>
    asList<FinanceEntry>(p),
  );
}

export interface CreateFinanceEntryBody {
  clientId: string;
  caseId?: string;
  type: FinancialEntryType;
  /** Decimal(18,2) — STRING. */
  amount: string;
  currency?: string;
  date: string;
  description?: string;
  isBillable?: boolean;
  vatRate?: string;
}

export function createFinanceEntry(body: CreateFinanceEntryBody): Promise<FinanceEntry> {
  return api<FinanceEntry>("/finance/entries", { method: "POST", body: clean(body) });
}

// --------------------------------------------------------------------- özetler

export function getClientFinanceSummary(clientId: string): Promise<ClientFinanceSummary> {
  return api<ClientFinanceSummary>(`/finance/clients/${clientId}/summary`);
}

export function getCaseFinanceSummary(caseId: string): Promise<ClientFinanceSummary> {
  return api<ClientFinanceSummary>(`/finance/cases/${caseId}/summary`);
}

/**
 * Büro geneli rapor.
 *
 * Yaşlandırma ve en borçlu müvekkiller rapor gövdesinde gelirse ayrı çağrı
 * yapılmaz; gelmezse `/finance/reports/aging` DENENİR. Bu ikinci deneme yalnızca
 * "uç yok" (gövdesiz 404 / ağ yok) durumunda sessizce geçilir — Türkçe iş mesajı
 * taşıyan gerçek hatalar yutulmaz (bkz. lib/faz2 → isMissingEndpoint).
 */
export interface OfficeReportQuery {
  dateFrom?: string;
  dateTo?: string;
  period?: string;
}

export async function getOfficeReport(
  query: OfficeReportQuery = {},
): Promise<OfficeFinanceReport> {
  const report = await api<OfficeFinanceReport>("/finance/reports/office", {
    query: { ...query },
  });

  const hasAging = Array.isArray(report.aging) && report.aging.length > 0;
  if (hasAging) return report;

  try {
    const aging = await api<unknown>("/finance/reports/aging", { query: { ...query } });
    return {
      ...report,
      aging: readAging(aging),
      topDebtors: report.topDebtors ?? readTopDebtors(aging),
    };
  } catch (err) {
    if (isMissingEndpoint(err)) return report;
    throw err;
  }
}

/** Yaşlandırma yanıtı dizi ya da `{ buckets: [...] }` olabilir. */
export function readAging(payload: unknown): AgingBucket[] {
  const direct = asList<AgingBucket>(payload);
  if (direct.length > 0) return direct;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["aging", "buckets", "ageing"]) {
      if (Array.isArray(obj[key])) return obj[key] as AgingBucket[];
    }
  }
  return [];
}

export function readTopDebtors(payload: unknown): TopDebtor[] {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["topDebtors", "debtors", "clients"]) {
      if (Array.isArray(obj[key])) return obj[key] as TopDebtor[];
    }
  }
  return [];
}

/** Özet alanlarını tek isimde toplar (sunucu iki adlandırmadan birini kullanabilir). */
export function summaryFields(s: ClientFinanceSummary | null) {
  if (!s) return null;
  return {
    openCases: s.openCases ?? s.openCaseCount ?? null,
    accrued: s.accrued ?? s.totalAccrued ?? null,
    collected: s.collected ?? s.totalCollected ?? null,
    outstanding: s.outstanding ?? s.pending ?? null,
    expenses: s.expenses ?? s.totalExpenses ?? null,
    advance: s.advanceBalance ?? s.advance ?? null,
    risk: s.collectionRisk ?? null,
    currency: s.currency ?? "TRY",
  };
}

function clean(body: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    out[key] = value;
  }
  return out;
}
