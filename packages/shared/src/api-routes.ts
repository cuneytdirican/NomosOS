/**
 * KİRACI API UÇ TABLOSU — İSTEMCİ VE SUNUCU İÇİN TEK KAYNAK.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NEDEN VAR: Faz 3 denetiminde `apps/web` katmanının SEKİZ ucu API'de     ║
 * ║ olmayan adreslere çağırdığı bulundu (denetim bulgusu 12). Fatura        ║
 * ║ detayındaki "Kesinleştir" ve "Ödeme kaydet" düğmeleri 404 alıyordu;     ║
 * ║ mali açıdan en riskli olanı, TAHSİLAT KAYDININ ARAYÜZDEN HİÇ            ║
 * ║ YAZILAMAMASIYDI — muhasebe ödeme girdiğini sanıp giremiyordu.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Uç adları elle iki yerde yazıldığı sürece bu sınıf hata tekrar üretilir.
 * Tablo burada, ortak pakette durur; istemci yolları buradan TÜRETİR.
 *
 * SÖZLEŞME: yollar `/api/v1` ÖNEKİ OLMADAN yazılır — önek istemcinin `api()`
 * yardımcısında, sunucunun ise `setGlobalPrefix` ayarındadır.
 */

export const BILLING_ROUTES = {
  feeAgreements: "/billing/fee-agreements",
  feeAgreement: (id: string) => `/billing/fee-agreements/${id}`,

  timeEntries: "/billing/time-entries",
  timeEntry: (id: string) => `/billing/time-entries/${id}`,
  timeEntrySummary: "/billing/time-entries/summary",

  invoices: "/billing/invoices",
  invoice: (id: string) => `/billing/invoices/${id}`,
  /** Zaman kayıtlarından taslak fatura üretimi (satırları SUNUCU kurar). */
  invoicesFromTimeEntries: "/billing/invoices/from-time-entries",
  /** Kesinleştirme. İstemci bir dönem `/approve` çağırıyordu — uç yok. */
  invoiceFinalize: (id: string) => `/billing/invoices/${id}/finalize`,
  invoiceCancel: (id: string) => `/billing/invoices/${id}/cancel`,
  /** e-Fatura gönderimi. İstemci bir dönem `/send` çağırıyordu — uç yok. */
  invoiceSendEInvoice: (id: string) => `/billing/invoices/${id}/e-invoice/send`,

  /**
   * TAHSİLAT KAYDI FATURA ALTINDA DEĞİL, KENDİ UCUNDADIR ve gövdesinde
   * `clientId` + `invoiceId` taşır (tahsilat faturasız da kaydedilebilir).
   */
  payments: "/billing/payments",
  payment: (id: string) => `/billing/payments/${id}`,

  eInvoiceProvider: "/billing/e-invoice/provider",
  taxpayerCheck: "/billing/taxpayer-check",
} as const;

export const FINANCE_ROUTES = {
  /** Büro geneli özet. İstemci bir dönem `/finance/reports/office` çağırıyordu. */
  summary: "/finance/summary",
  clientSummary: (clientId: string) => `/finance/clients/${clientId}/summary`,
  caseSummary: (caseId: string) => `/finance/cases/${caseId}/summary`,
  ask: "/finance/ask",
  entries: "/finance/entries",
  entry: (id: string) => `/finance/entries/${id}`,
} as const;

export const ENFORCEMENT_ROUTES = {
  list: "/enforcement",
  detail: (id: string) => `/enforcement/${id}`,
  stage: (id: string) => `/enforcement/${id}/stage`,
  actions: (id: string) => `/enforcement/${id}/actions`,
  /** Tekil işlem kaydı — dosyadan BAĞIMSIZ adreslenir. */
  action: (actionId: string) => `/enforcement-actions/${actionId}`,
  assets: (id: string) => `/enforcement/${id}/assets`,
  /** Tekil malvarlığı kaydı — dosyadan BAĞIMSIZ adreslenir (`/assets/:id`). */
  asset: (assetId: string) => `/assets/${assetId}`,
  collections: (id: string) => `/enforcement/${id}/collections`,
  balance: (id: string) => `/enforcement/${id}/balance`,
  deadlines: (id: string) => `/enforcement/${id}/deadlines`,
  suggestDeadlines: (id: string) => `/enforcement/${id}/deadlines/suggest`,
  score: (id: string) => `/enforcement/${id}/score`,
  /**
   * Skor YENİDEN HESABI ayrı bir uç DEĞİLDİR: copilot'un
   * `TAHSILAT_IHTIMALI` komutu skoru üretir ve kaydeder.
   */
  copilot: (id: string) => `/enforcement/${id}/copilot`,
} as const;
