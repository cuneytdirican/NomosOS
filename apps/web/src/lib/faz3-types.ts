/**
 * Faz 3 görünüm tipleri — İcra, Finans, Faturalama.
 *
 * Alan adları `packages/db/prisma/schema.prisma` ile uyumludur.
 *
 * PARA ALANLARI `string`'tir (Prisma Decimal(18,2)). Bunları `number`'a
 * ÇEVİRMEYİN; `lib/money.ts` yardımcıları kuruş tamsayısı üzerinden çalışır.
 * (JSON'da düz sayı da düşebildiği için tipler `string | number` kabul eder,
 * ama okuma daima `toKurus()` üzerinden yapılır.)
 */

export type Money = string | number | null | undefined;

// ------------------------------------------------------------------ İcra

export type EnforcementType =
  | "ILAMLI"
  | "ILAMSIZ"
  | "KAMBIYO"
  | "REHNIN_PARAYA_CEVRILMESI"
  | "IPOTEGIN_PARAYA_CEVRILMESI"
  | "NAFAKA"
  | "TAHLIYE";

export type EnforcementStage =
  | "TAKIP_TALEBI"
  | "ODEME_EMRI_TEBLIG"
  | "ITIRAZ"
  | "ITIRAZIN_KALDIRILMASI"
  | "KESINLESME"
  | "HACIZ"
  | "SATIS"
  | "TAHSILAT"
  | "ACIZ_VESIKASI"
  | "KAPANDI";

export type EnforcementActionType =
  | "TAKIP_TALEBI"
  | "ODEME_EMRI"
  | "ITIRAZ"
  | "ITIRAZIN_IPTALI"
  | "HACIZ_TALEBI"
  | "HACIZ_UYGULAMA"
  | "KIYMET_TAKDIRI"
  | "SATIS_TALEBI"
  | "IHALE"
  | "TAHSILAT"
  | "HARC_ODEME"
  | "MASRAF"
  | "DIGER";

export type AssetType =
  | "TASINMAZ"
  | "ARAC"
  | "BANKA_HESABI"
  | "MAAS"
  | "ALACAK"
  | "HISSE"
  | "DIGER";

export type AssetStatus =
  | "TESPIT_EDILDI"
  | "HACZEDILDI"
  | "SATISA_CIKARILDI"
  | "SATILDI"
  | "SERBEST_BIRAKILDI";

export type CollectionMethod =
  | "BANKA"
  | "KASA"
  | "HACIZ_SATIS"
  | "MAAS_KESINTISI"
  | "ANLASMA"
  | "DIGER";

export type ScoreBand = "DUSUK" | "ORTA" | "YUKSEK";

export interface EnforcementCaseRef {
  id: string;
  title?: string;
  type?: string;
  status?: string;
  fileNumber?: string | null;
  client?: { id: string; name: string } | null;
}

export interface EnforcementAction {
  id: string;
  enforcementFileId?: string;
  type: EnforcementActionType;
  date: string;
  description: string;
  amount?: Money;
  resultNote?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

export interface AssetRecord {
  id: string;
  enforcementFileId?: string;
  assetType: AssetType;
  description: string;
  estimatedValue?: Money;
  status: AssetStatus;
  discoveredAt: string;
  note?: string | null;
}

export interface CollectionRecord {
  id: string;
  enforcementFileId?: string;
  amount: Money;
  date: string;
  method: CollectionMethod;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

export interface CollectionScore {
  id?: string;
  enforcementFileId?: string;
  score: number;
  band: ScoreBand;
  /** Kural tabanlı sinyaller — skorun DETERMİNİSTİK kaynağı. */
  ruleSignals?: RuleSignal[];
  ruleSignalsJson?: RuleSignal[] | string | null;
  /** AI yalnızca YORUM yazar; skoru belirlemez. */
  aiCommentary?: string | null;
  model?: string | null;
  computedAt?: string;
  computedBy?: string | null;
  /** Skoru etkileyen yeni işlem sonrası "güncel değil" rozeti (İş kuralı 7). */
  stale?: boolean;
}

export interface RuleSignal {
  key?: string;
  label?: string;
  name?: string;
  value?: string | number | boolean | null;
  weight?: number | null;
  direction?: "POZITIF" | "NEGATIF" | "NOTR" | string | null;
  note?: string | null;
}

export interface EnforcementFile {
  id: string;
  caseId: string;
  case?: EnforcementCaseRef | null;
  officeName: string;
  fileNumber: string;
  trackingType: EnforcementType;
  stage: EnforcementStage;
  principalAmount: Money;
  interestRate?: Money;
  currency?: string;
  requestDate: string;
  paymentOrderServedAt?: string | null;
  objectionDate?: string | null;
  finalizedAt?: string | null;
  closedAt?: string | null;
  /** KVKK: dış LLM'e gitmeden maskelenir; ekranda büro içi görünür. */
  debtorInfo?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Liste ucunun türettiği toplamlar (sunucu hesabı). */
  collectedTotal?: Money;
  remainingTotal?: Money;
  totalClaim?: Money;
  latestScore?: CollectionScore | null;
  actions?: EnforcementAction[];
  assets?: AssetRecord[];
  collections?: CollectionRecord[];
  _count?: { actions?: number; assets?: number; collections?: number };
}

/** GET /enforcement/:id/balance — SUNUCU hesabı; istemci yalnız gösterir. */
export interface BalanceStep {
  label?: string;
  step?: string;
  amount?: Money;
  explanation?: string | null;
  note?: string | null;
}

export interface EnforcementBalance {
  asOf?: string;
  currency?: string;
  principal?: Money;
  interest?: Money;
  expenses?: Money;
  attorneyFee?: Money;
  totalClaim?: Money;
  collected?: Money;
  remaining?: Money;
  /** Hesap dökümü — açılır panelde adım adım gösterilir. */
  steps?: BalanceStep[];
  calculationSteps?: BalanceStep[];
  warnings?: string[];
  legalBasis?: string | null;
}

export type CopilotCommand =
  | "ENF_ASSET_ANALYSIS"
  | "ENF_NEXT_ACTIONS"
  | "ENF_MISSED_DEADLINES"
  | "ENF_COLLECTION_SCORE"
  | "ENF_ACTION_LOG_ANALYSIS"
  | "ENF_OBJECTION_COMPARE";

/** POST /enforcement/:id/copilot yanıtı (öneri niteliğindedir). */
export interface CopilotResult {
  command?: CopilotCommand | string;
  /** Serbest metin özet. */
  summary?: string;
  text?: string;
  content?: string;
  /** Maddeli çıktı (aksiyon listesi, kaçırılan süre, itiraz eşleşmesi). */
  items?: CopilotItem[];
  /** Kaynak gösterimi zorunlu — dosyadaki hangi kayda dayandığı. */
  sources?: CopilotSource[];
  citations?: CopilotSource[];
  reasoning?: string | null;
  warnings?: string[];
  model?: string | null;
  /** ENF_COLLECTION_SCORE çıktısı. */
  score?: CollectionScore | null;
  /** Skor komutunda ayrı alan olarak da gelebilir. */
  ruleSignals?: RuleSignal[];
}

export interface CopilotItem {
  title?: string;
  label?: string;
  detail?: string | null;
  description?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  legalBasis?: string | null;
  status?: string | null;
  note?: string | null;
}

export interface CopilotSource {
  kind?: string | null;
  label?: string | null;
  refId?: string | null;
  documentId?: string | null;
  quote?: string | null;
  date?: string | null;
  verified?: boolean;
}

// ---------------------------------------------------------------- Finans

export type FinancialEntryType =
  | "TAHAKKUK"
  | "TAHSILAT"
  | "AVANS"
  | "MASRAF"
  | "HARC"
  | "VEKALET_UCRETI"
  | "DANISMANLIK"
  | "IADE";

export interface FinanceEntry {
  id: string;
  clientId?: string | null;
  caseId?: string | null;
  type: FinancialEntryType;
  amount: Money;
  currency?: string;
  date: string;
  description?: string | null;
  invoiceId?: string | null;
  isBillable?: boolean;
  vatRate?: Money;
  createdAt?: string;
  client?: { id: string; name: string } | null;
  case?: { id: string; title: string; fileNumber?: string | null } | null;
}

/** GET /finance/clients/:id/summary — DETERMİNİSTİK; AI hesap yapmaz. */
export interface ClientFinanceSummary {
  clientId?: string;
  currency?: string;
  openCases?: number;
  openCaseCount?: number;
  accrued?: Money;
  totalAccrued?: Money;
  collected?: Money;
  totalCollected?: Money;
  outstanding?: Money;
  pending?: Money;
  expenses?: Money;
  totalExpenses?: Money;
  advanceBalance?: Money;
  advance?: Money;
  collectionRisk?: "DUSUK" | "ORTA" | "YUKSEK" | "LOW" | "MEDIUM" | "HIGH" | string | null;
  entries?: FinanceEntry[];
}

export interface AgingBucket {
  key?: string;
  label?: string;
  /** "0-30" | "31-60" | "61-90" | "90+" */
  range?: string;
  amount: Money;
  count?: number;
}

export interface TopDebtor {
  clientId: string;
  clientName?: string;
  name?: string;
  outstanding: Money;
  overdueDays?: number | null;
  collectionRisk?: string | null;
  currency?: string;
}

/** GET /finance/reports/office — büro geneli özet (sunucu hesabı). */
export interface OfficeFinanceReport {
  period?: string;
  currency?: string;
  monthAccrued?: Money;
  monthCollected?: Money;
  totalReceivable?: Money;
  totalOutstanding?: Money;
  totalExpenses?: Money;
  advanceBalance?: Money;
  aging?: AgingBucket[];
  topDebtors?: TopDebtor[];
  monthlySeries?: Array<{ month: string; accrued: Money; collected: Money }>;
}

// ----------------------------------------------------------- Faturalama

export type FeeType =
  | "SABIT"
  | "SAATLIK"
  | "BASARI_PRIMI"
  | "DOSYA_BAZLI"
  | "AYLIK_DANISMANLIK"
  | "KARMA";

export type AgreementStatus = "TASLAK" | "AKTIF" | "SONA_ERDI" | "FESIH";

export type InvoiceStatus =
  | "TASLAK"
  | "GONDERILDI"
  | "KISMI_ODENDI"
  | "ODENDI"
  | "IPTAL"
  | "IADE";

export type EInvoiceStatus = "YOK" | "BEKLIYOR" | "GONDERILDI" | "KABUL" | "RED" | "IPTAL";

export type PaymentMethod =
  | "HAVALE"
  | "KREDI_KARTI"
  | "NAKIT"
  | "CEK"
  | "SENET"
  | "MAHSUP"
  | "DIGER";

/** InvoiceLine.sourceType enum DEĞİL, serbest string — bu küme ile sınırlanır. */
export const INVOICE_LINE_SOURCES = ["TIME_ENTRY", "FEE_AGREEMENT", "EXPENSE", "MANUEL"] as const;
export type InvoiceLineSource = (typeof INVOICE_LINE_SOURCES)[number];

export interface FeeAgreement {
  id: string;
  clientId: string;
  caseId?: string | null;
  type: FeeType;
  amount?: Money;
  hourlyRate?: Money;
  successPercent?: Money;
  currency?: string;
  /** KDV oranı KAYITTAN okunur, koda gömülmez. */
  vatRate?: Money;
  startDate: string;
  endDate?: string | null;
  terms?: string | null;
  status: AgreementStatus;
  createdAt?: string;
  updatedAt?: string;
  client?: { id: string; name: string } | null;
  case?: { id: string; title: string } | null;
}

export interface TimeEntry {
  id: string;
  userId?: string;
  caseId?: string | null;
  clientId?: string | null;
  date: string;
  /** TAMSAYI DAKİKA. Saate çevrim yalnızca gösterimde. */
  minutes: number;
  description: string;
  billable?: boolean;
  hourlyRate?: Money;
  /** Skaler — ilişki DEĞİL. Dolu ise kayıt faturalanmıştır. */
  invoiceId?: string | null;
  /** Faz 6 — timesheet onayı: TASLAK | ONAY_BEKLIYOR | ONAYLANDI | REDDEDILDI. Yalnız ONAYLANDI faturalanır. */
  status?: string;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  createdAt?: string;
  user?: { id: string; fullName?: string } | null;
  case?: { id: string; title: string; fileNumber?: string | null } | null;
  client?: { id: string; name: string } | null;
}

export interface InvoiceLine {
  id?: string;
  invoiceId?: string;
  description: string;
  quantity: Money;
  unitPrice: Money;
  vatRate: Money;
  lineTotal?: Money;
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface InvoicePayment {
  id: string;
  invoiceId?: string | null;
  clientId?: string;
  amount: Money;
  date: string;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  /** Faz 6 — storno: dolu ise tahsilat ters kayıtla kapatılmıştır (bakiyede sayılmaz). */
  stornoAt?: string | null;
  stornoReason?: string | null;
}

export interface Invoice {
  id: string;
  clientId: string;
  invoiceNo?: string | null;
  issueDate: string;
  dueDate?: string | null;
  /** Tümü SUNUCU hesabıdır — istemci yeniden hesaplamaz. */
  subtotal: Money;
  vatAmount: Money;
  total: Money;
  currency?: string;
  status: InvoiceStatus;
  eInvoiceStatus?: EInvoiceStatus;
  eInvoiceUuid?: string | null;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  client?: { id: string; name: string; taxNumber?: string | null } | null;
  lines?: InvoiceLine[];
  payments?: InvoicePayment[];
  /** Sunucunun döndürdüğü kalan bakiye (varsa). */
  paidTotal?: Money;
  remaining?: Money;
}

/** e-Fatura gönderiminde entegratör yapılandırılmamışsa dönen bilgilendirme. */
export interface EInvoiceSendResult {
  configured?: boolean;
  adapter?: string | null;
  status?: EInvoiceStatus | string;
  message?: string | null;
  warnings?: string[];
}
