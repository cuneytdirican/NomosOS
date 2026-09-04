/**
 * Faturalama API istemcisi — `/api/v1/billing/**` (Modül 09).
 *
 * UÇ ADLARI `@nomosos/shared` İÇİNDEKİ TEK TABLODAN GELİR (`BILLING_ROUTES`).
 * Elle yazıldıkları sürece istemci ile sunucu ayrışıyordu: denetimde bu
 * dosyadaki `/approve`, `/send`, `/invoices/:id/payments` ve `/pdf` uçlarının
 * API'de HİÇ BULUNMADIĞI, dolayısıyla "Kesinleştir" ve "Ödeme kaydet"
 * düğmelerinin 404 aldığı tespit edildi (denetim bulgusu 12).
 *
 * GERÇEK SÖZLEŞME (billing.controller.ts):
 *   GET/POST  /billing/fee-agreements          — ücret sözleşmeleri
 *   PATCH     /billing/fee-agreements/:id
 *   GET/POST  /billing/time-entries            — zaman kayıtları
 *   DELETE    /billing/time-entries/:id
 *   GET/POST  /billing/invoices                — fatura listesi / taslak oluşturma
 *   POST      /billing/invoices/from-time-entries
 *   GET       /billing/invoices/:id
 *   POST      /billing/invoices/:id/finalize   — kesinleştir (numara SUNUCUDA atanır)
 *   POST      /billing/invoices/:id/cancel
 *   POST      /billing/invoices/:id/e-invoice/send
 *   POST      /billing/payments                — tahsilat (gövdede clientId + invoiceId)
 *
 * PARA İLKESİ: `subtotal`, `vatAmount`, `total` ve `lineTotal` alanlarının
 * TEK KAYNAĞI SUNUCUDUR. İstemci fatura oluştururken yalnızca satır girdilerini
 * (açıklama, miktar, birim fiyat, KDV oranı) gönderir; toplam ALANLARINI ASLA
 * GÖNDERMEZ ve kaydettikten sonra yanıttaki toplamları gösterir.
 *
 * KDV ORANI KODA GÖMÜLMEZ: varsayılan `DEFAULT_VAT_RATE` yalnızca form ön
 * değeridir; kayıtlı sözleşmenin `vatRate` alanı varsa o kullanılır.
 */

import { BILLING_ROUTES } from "@nomosos/shared";
import { api, asList, fetchPaged, type PagedResult } from "@/lib/api";
import type {
  AgreementStatus,
  EInvoiceSendResult,
  FeeAgreement,
  FeeType,
  Invoice,
  InvoiceLine,
  InvoicePayment,
  PaymentMethod,
  TimeEntry,
} from "@/lib/faz3-types";

/**
 * Form ön değeri (vekâlet ücreti / danışmanlıkta genel oran). Sabit DEĞİLDİR:
 * sözleşmede oran tanımlıysa o okunur, kullanıcı da değiştirebilir.
 */
export const DEFAULT_VAT_RATE = "20";

// ------------------------------------------------------- ücret sözleşmeleri

export interface FeeAgreementQuery {
  clientId?: string;
  caseId?: string;
  status?: string;
}

export function listFeeAgreements(query: FeeAgreementQuery = {}): Promise<FeeAgreement[]> {
  return api<unknown>(BILLING_ROUTES.feeAgreements, { query: { ...query } }).then((p) =>
    asList<FeeAgreement>(p),
  );
}

export interface CreateFeeAgreementBody {
  clientId: string;
  caseId?: string;
  type: FeeType;
  /** Tipe göre doldurulur; hepsi Decimal → STRING. */
  amount?: string;
  hourlyRate?: string;
  successPercent?: string;
  currency?: string;
  vatRate?: string;
  startDate: string;
  endDate?: string;
  terms?: string;
  status?: AgreementStatus;
}

export function createFeeAgreement(body: CreateFeeAgreementBody): Promise<FeeAgreement> {
  return api<FeeAgreement>(BILLING_ROUTES.feeAgreements, { method: "POST", body: clean(body) });
}

export function updateFeeAgreement(
  id: string,
  patch: Partial<CreateFeeAgreementBody>,
): Promise<FeeAgreement> {
  return api<FeeAgreement>(BILLING_ROUTES.feeAgreement(id), {
    method: "PATCH",
    body: clean(patch),
  });
}

// ------------------------------------------------------------ zaman kayıtları

export interface TimeEntryQuery {
  clientId?: string;
  caseId?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  billable?: boolean;
  /** true → yalnızca faturalanmamış (invoiceId boş) kayıtlar. */
  unbilled?: boolean;
  limit?: number;
}

export function listTimeEntries(query: TimeEntryQuery = {}): Promise<TimeEntry[]> {
  return api<unknown>(BILLING_ROUTES.timeEntries, { query: { ...query } }).then((p) =>
    asList<TimeEntry>(p),
  );
}

/**
 * Faturalanmamış zaman kayıtları.
 *
 * Sunucu `unbilled` süzgecini uygulamıyor olabilir; bu yüzden faturaya
 * girmiş kayıtlar İSTEMCİDE DE elenir. Bu bir hesap değil, güvenlik amaçlı
 * ikinci süzgeçtir: faturalanmış bir kaydı ikinci kez faturalatmamak için.
 */
export async function listUnbilledTimeEntries(query: TimeEntryQuery): Promise<TimeEntry[]> {
  const list = await listTimeEntries({ ...query, billable: true, unbilled: true });
  return list.filter((t) => !t.invoiceId && t.billable !== false);
}

export interface CreateTimeEntryBody {
  caseId?: string;
  clientId?: string;
  date: string;
  /** TAMSAYI DAKİKA. */
  minutes: number;
  description: string;
  billable?: boolean;
  hourlyRate?: string;
}

export function createTimeEntry(body: CreateTimeEntryBody): Promise<TimeEntry> {
  return api<TimeEntry>(BILLING_ROUTES.timeEntries, { method: "POST", body: clean(body) });
}

export function deleteTimeEntry(id: string): Promise<unknown> {
  return api<unknown>(BILLING_ROUTES.timeEntry(id), { method: "DELETE" });
}

// --------------------------------------------------------------- faturalar

export interface InvoiceQuery {
  status?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

/**
 * Faturalar — SAYFALAMA ZARFIYLA (denetim bulgusu K-15).
 * `limit: 200` isteyip `total`'i atmak, 200'den fazla faturası olan büroda
 * faturaların sessizce kaybolması demekti.
 */
export async function listInvoicesPaged(
  query: InvoiceQuery & { page?: number } = {},
): Promise<PagedResult<Invoice>> {
  const { page, limit, ...filters } = query;
  return fetchPaged<Invoice>(BILLING_ROUTES.invoices, { query: { ...filters }, page, limit });
}

export function listInvoices(query: InvoiceQuery = {}): Promise<Invoice[]> {
  return api<unknown>(BILLING_ROUTES.invoices, { query: { ...query } }).then((p) => asList<Invoice>(p));
}

export function getInvoice(id: string): Promise<Invoice> {
  return api<Invoice>(BILLING_ROUTES.invoice(id));
}

/** Fatura satırı GİRDİSİ — `lineTotal` YOKTUR, sunucu hesaplar. */
export interface InvoiceLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  sourceType?: string;
  sourceId?: string;
}

export interface CreateInvoiceBody {
  clientId: string;
  issueDate: string;
  dueDate?: string;
  currency?: string;
  note?: string;
  lines?: InvoiceLineInput[];
  /** Zaman kayıtlarından fatura: sunucu satırları kendisi üretir. */
  timeEntryIds?: string[];
  /** Finans hareketlerinden (masraf yansıtma) fatura. */
  financialEntryIds?: string[];
}

export function createInvoice(body: CreateInvoiceBody): Promise<Invoice> {
  return api<Invoice>(BILLING_ROUTES.invoices, { method: "POST", body: clean(body) });
}

/**
 * Zaman kayıtlarından fatura — AYRI uç (POST /billing/invoices/from-time-entries).
 * Satırları ve tutarları SUNUCU üretir; istemci yalnız aralık/seçim gönderir.
 */
export function createInvoiceFromTimeEntries(
  body: CreateInvoiceBody & { from: string; to: string; caseId?: string | null; vatRate?: string },
): Promise<Invoice> {
  return api<Invoice>(BILLING_ROUTES.invoicesFromTimeEntries, { method: "POST", body: clean(body) });
}

/** Kesinleştirme — fatura numarası SUNUCUDA atanır (taslaklar numara tüketmez). */
export function approveInvoice(id: string): Promise<Invoice> {
  return api<Invoice>(BILLING_ROUTES.invoiceFinalize(id), { method: "POST", body: {} });
}

export function cancelInvoice(id: string, reason: string): Promise<Invoice> {
  return api<Invoice>(BILLING_ROUTES.invoiceCancel(id), {
    method: "POST",
    body: clean({ reason }),
  });
}

/**
 * e-Fatura gönderimi.
 *
 * GİB'e gerçek bağlantı YOKTUR. Entegratör yapılandırılmamışsa sunucu kaydı
 * TASLAK/YOK durumunda bırakır ve bilgilendirme döndürür; arayüz bunu net
 * biçimde gösterir, "gönderildi" gibi DAVRANMAZ.
 */
export function sendInvoice(id: string): Promise<EInvoiceSendResult> {
  return api<EInvoiceSendResult>(BILLING_ROUTES.invoiceSendEInvoice(id), {
    method: "POST",
    body: {},
  });
}

/**
 * A6 (rakip analizi): e-SMM (Serbest Meslek Makbuzu) gönderimi.
 * e-Fatura ile AYRI belge türüdür; sağlayıcı altyapısı ortaktır.
 */
export function sendESmm(id: string): Promise<Invoice> {
  return api<Invoice>(BILLING_ROUTES.invoiceSendESmm(id), { method: "POST", body: {} });
}

/**
 * E8 (rakip analizi): fatura için TEK KULLANIMLIK ödeme bağlantısı üretir.
 * Bağlantı token'lı URL'dir; müvekkil portaldan öder.
 */
export function createOdemeLinki(id: string): Promise<{ token: string; amount: string; currency: string; expiresAt: string; odemeUrl: string }> {
  return api(`/billing/invoices/${id}/odeme-linki`, { method: "POST", body: {} });
}

export interface CreatePaymentBody {
  amount: string;
  date: string;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  /**
   * Kalan bakiyeyi aşan tahsilatı bilerek kabul et.
   *
   * Sunucu, tutar kalan bakiyeyi aşarsa 400 + `remaining` /
   * `overpaymentAmount` döndürür; arayüz bunu kullanıcıya GÖSTERİP onay
   * aldıktan sonra bu bayrakla ikinci turu yapar. Fazlalık müvekkil carisinde
   * avans olarak kalır.
   */
  allowOverpayment?: boolean;
}

/**
 * Fatura tahsilatı.
 *
 * UÇ FATURA ALTINDA DEĞİLDİR: sunucu sözleşmesi `POST /billing/payments` ve
 * gövde `clientId` + `invoiceId` ister (tahsilat faturasız da kaydedilebilir).
 * İstemci `POST /billing/invoices/:id/payments` çağırdığı için tahsilat
 * arayüzden HİÇ yazılamıyordu (denetim bulgusu 12) — muhasebe açısından
 * modülün en riskli kopukluğuydu.
 */
export function createInvoicePayment(
  id: string,
  clientId: string,
  body: CreatePaymentBody,
): Promise<InvoicePayment> {
  return api<InvoicePayment>(BILLING_ROUTES.payments, {
    method: "POST",
    body: clean({ ...body, clientId, invoiceId: id }),
  });
}

/** Fatura satırlarını tek biçimde okur. */
export function linesOf(inv: Invoice | null | undefined): InvoiceLine[] {
  return inv?.lines ?? [];
}

function clean(body: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}
