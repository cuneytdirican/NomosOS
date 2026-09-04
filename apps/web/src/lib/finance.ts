/**
 * Finans modülü API istemcisi — `/api/v1/finance/**` (Modül 08).
 *
 * UÇ ADLARI `@nomosos/shared` İÇİNDEKİ TEK TABLODAN GELİR (`FINANCE_ROUTES`).
 *
 * GERÇEK SÖZLEŞME (finance.controller.ts):
 *   GET/POST /finance/entries                   — hareket listesi / oluşturma
 *   GET      /finance/clients/:clientId/summary — müvekkil finans özeti
 *   GET      /finance/cases/:caseId/summary     — dosya finans özeti
 *   GET      /finance/summary                   — büro geneli özet (dönem parametreli)
 *
 * `/finance/reports/office` ve `/finance/reports/aging` uçları API'de HİÇ
 * BULUNMUYOR (denetim bulgusu 12); büro raporu `/finance/summary`'dir ve
 * yaşlandırma onun `receivables.aging` alanında gelir — ayrı çağrı yoktur.
 *
 * PARA İLKESİ: bu dosya HİÇBİR toplam hesaplamaz. Tahakkuk, tahsilat, bekleyen
 * bakiye, yaşlandırma kovaları ve avans bakiyesi SUNUCUDAN gelir. Sunucu bir
 * alanı göndermiyorsa arayüz "—" gösterir; eksik veriyi sıfır sanıp toplamaz.
 */

import { FINANCE_ROUTES } from "@nomosos/shared";
import { api, asList, fetchPaged, type PagedResult } from "@/lib/api";
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

/**
 * Finans hareketleri — SAYFALAMA ZARFIYLA (denetim bulgusu K-15).
 *
 * Önceden ekranlar `limit: 200` isteyip zarfı atıyordu; 200'den fazla hareketi
 * olan büroda kalan hareketler hiçbir ekranda görünmüyordu ve kırpıldığına
 * dair bir işaret yoktu.
 */
export async function listFinanceEntriesPaged(
  query: FinanceEntryQuery & { page?: number } = {},
): Promise<PagedResult<FinanceEntry>> {
  // Sunucu sözleşmesi ?from=&to= (finance.controller.ts); istemci arayüzü
  // dateFrom/dateTo adını kullanır — burada tek noktada çevrilir.
  const { page, limit, dateFrom, dateTo, ...filters } = query;
  return fetchPaged<FinanceEntry>(FINANCE_ROUTES.entries, {
    query: { ...filters, from: dateFrom, to: dateTo },
    page,
    limit,
  });
}

export function listFinanceEntries(query: FinanceEntryQuery = {}): Promise<FinanceEntry[]> {
  return api<unknown>(FINANCE_ROUTES.entries, { query: { ...query } }).then((p) =>
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
  return api<FinanceEntry>(FINANCE_ROUTES.entries, { method: "POST", body: clean(body) });
}

// --------------------------------------------------------------------- özetler

export function getClientFinanceSummary(clientId: string): Promise<ClientFinanceSummary> {
  return api<ClientFinanceSummary>(FINANCE_ROUTES.clientSummary(clientId));
}

export function getCaseFinanceSummary(caseId: string): Promise<ClientFinanceSummary> {
  return api<ClientFinanceSummary>(FINANCE_ROUTES.caseSummary(caseId));
}

/**
 * Büro geneli rapor — TEK ÇAĞRI.
 *
 * Yaşlandırma AYRI BİR UÇ DEĞİLDİR: `/finance/summary` yanıtı onu
 * `receivables.aging` alanında taşır. Önceki sürüm önce olmayan bir
 * `/finance/reports/office` ucunu çağırıyor, sonra yine olmayan bir
 * `/finance/reports/aging` ucuna düşüyordu; ikisi de 404 üretiyordu
 * (denetim bulgusu 12).
 */
export interface OfficeReportQuery {
  /** Sunucu sözleşmesi: ?from=&to= (finance.controller.ts @Query("from"/"to")). */
  dateFrom?: string;
  dateTo?: string;
  period?: string;
}

export async function getOfficeReport(
  query: OfficeReportQuery = {},
): Promise<OfficeFinanceReport> {
  const { dateFrom, dateTo, ...rest } = query;
  const raw = await api<
    OfficeFinanceReport & {
      receivables?: unknown;
      periodTotals?: Array<Record<string, unknown>>;
      allTimeTotals?: Array<Record<string, unknown>>;
    }
  >(FINANCE_ROUTES.summary, { query: { ...rest, from: dateFrom, to: dateTo } });

  // Sunucu özeti para birimi kovalarıyla döner ({periodTotals, allTimeTotals});
  // kartların okuduğu düz alanlara İLK kova üzerinden haritalanır.
  const period = raw.periodTotals?.[0];
  const allTime = raw.allTimeTotals?.[0];
  const report: OfficeFinanceReport = {
    ...raw,
    currency: (period?.currency as string) ?? raw.currency,
    monthAccrued: (period?.accrued as string) ?? raw.monthAccrued,
    monthCollected: (period?.netCollected as string) ?? raw.monthCollected,
    totalOutstanding: (allTime?.outstanding as string) ?? raw.totalOutstanding,
    totalExpenses: (allTime?.expenses as string) ?? raw.totalExpenses,
    advanceBalance: (allTime?.advanceBalance as string) ?? raw.advanceBalance,
  };

  const hasAging = Array.isArray(report.aging) && report.aging.length > 0;
  if (hasAging) return report;

  // Sunucu yaşlandırmayı `receivables.aging` altında döndürür; iki biçimi de
  // okuyabilmek için tek yardımcıdan geçirilir.
  return {
    ...report,
    aging: readAging(raw.receivables ?? report),
    topDebtors: report.topDebtors ?? readTopDebtors(report),
  };
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
