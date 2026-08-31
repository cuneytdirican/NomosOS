/**
 * Rapor builder'larının ortak yardımcıları: ölçü (metric) kurulumu, karşılaştırma
 * aritmetiği, durum kümeleri ve satır sınırı.
 *
 * KARŞILAŞTIRMA ARİTMETİĞİ — SIFIRA BÖLME UYDURULMAZ:
 * Önceki dönem 0 ise yüzde değişim `null` döner (arayüz "—" gösterir). Eskiden
 * bu tür yerlerde 100 ya da 0 yazmak yaygındı; ikisi de YANLIŞ bilgi üretir:
 * 0'dan 5'e çıkmak "%100 artış" değildir, tanımsızdır.
 */

import { Prisma } from "@nomosos/db";
import type {
  CaseStatus as DbCaseStatus,
  DeadlineStatus as DbDeadlineStatus,
  FinancialEntryType,
  TaskStatus as DbTaskStatus,
} from "@nomosos/db";
import { moneyOut } from "../finance/money";
import type { ReportCell, ReportMetric, ReportTable } from "./report-types";

/* ─────────────────────────── Durum kümeleri ─────────────────────────── */

export const OPEN_TASK_STATUSES: DbTaskStatus[] = [
  "ACIK",
  "DEVAM_EDIYOR",
  "KONTROLDE",
  "ONAY_BEKLIYOR",
];

export const OPEN_DEADLINE_STATUSES: DbDeadlineStatus[] = ["BEKLIYOR", "ONAYLANDI"];

export const ACTIVE_CASE_STATUSES: DbCaseStatus[] = [
  "ACIK",
  "DERDEST",
  "KARAR",
  "ISTINAF",
  "TEMYIZ",
  "KESINLESTI",
  "ICRADA",
];

export const CLOSED_CASE_STATUSES: DbCaseStatus[] = ["KAPANDI", "ARSIV"];

/**
 * TAHAKKUK KÜMESİ — `finance-summary.service.ts` ile BİREBİR aynıdır.
 * İki modülün "tahakkuk" tanımı ayrışırsa aynı büro için iki farklı rakam
 * çıkar; bu yüzden küme kopyalanırken kaynağı burada belirtilir.
 */
export const ACCRUAL_TYPES: FinancialEntryType[] = ["TAHAKKUK", "VEKALET_UCRETI", "DANISMANLIK"];
export const EXPENSE_TYPES: FinancialEntryType[] = ["MASRAF", "HARC"];

/** Bakiyesi olabilen (açık) fatura durumları. */
export const OPEN_INVOICE_STATUSES = ["GONDERILDI", "KISMI_ODENDI"] as const;

/* ────────────────────────────── Ölçüler ────────────────────────────── */

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

export interface MetricOptions {
  higherIsBetter?: boolean;
  critical?: boolean;
  definition?: string;
}

export function countMetric(
  key: string,
  label: string,
  value: number,
  previous: number | undefined,
  options: MetricOptions = {},
): ReportMetric {
  const metric: ReportMetric = {
    key,
    label,
    type: "number",
    value,
    higherIsBetter: options.higherIsBetter,
    critical: options.critical,
    definition: options.definition,
  };
  if (previous !== undefined) {
    metric.previous = previous;
    metric.delta = value - previous;
    metric.deltaPercent = percentChange(value, previous);
  }
  return metric;
}

export function moneyMetric(
  key: string,
  label: string,
  value: Prisma.Decimal,
  previous: Prisma.Decimal | undefined,
  currency: string,
  options: MetricOptions = {},
): ReportMetric {
  const metric: ReportMetric = {
    key,
    label,
    type: "money",
    value: moneyOut(value),
    currency,
    higherIsBetter: options.higherIsBetter,
    critical: options.critical,
    definition: options.definition,
  };
  if (previous !== undefined) {
    metric.previous = moneyOut(previous);
    metric.delta = moneyOut(value.minus(previous));
    // Yüzde, Decimal'den `number`'a YALNIZ oran hesabı için düşer; para
    // tutarının kendisi hiçbir zaman float'a çevrilmez.
    metric.deltaPercent = previous.isZero()
      ? null
      : Math.round(value.minus(previous).div(previous).mul(10000).toNumber()) / 100;
  }
  return metric;
}

/**
 * Yüzde ölçüsü.
 *
 * `value === null` MEŞRU BİR DEĞERDİR ve 0'dan farklıdır: "oran ölçülemedi"
 * (payda yok) ile "oran sıfır" (payda var, pay yok) aynı şey değildir. Dönem
 * içinde hiç fatura kesmemiş ama 500.000 TL tahsil etmiş bir büroya
 * "Tahsil oranı %0" yazmak, gerçeğin tersini söylemekti.
 */
export function percentMetric(
  key: string,
  label: string,
  value: number | null,
  previous: number | undefined,
  options: MetricOptions = {},
): ReportMetric {
  const metric: ReportMetric = {
    key,
    label,
    type: "percent",
    value: value === null ? null : Math.round(value * 100) / 100,
    higherIsBetter: options.higherIsBetter,
    critical: options.critical,
    definition: options.definition,
  };
  if (value !== null && previous !== undefined) {
    metric.previous = Math.round(previous * 100) / 100;
    metric.delta = Math.round((value - previous) * 100) / 100;
    metric.deltaPercent = percentChange(value, previous);
  }
  return metric;
}

/** İki sayının yüzdesi; payda 0 ise 0 (oran tanımsız değil, ölçüm yok). */
export function ratioPercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

/* ───────────────────────────── Satır sınırı ───────────────────────────── */

/**
 * Satır sınırı uygular ve tabloyu "kırpıldı" olarak işaretler.
 *
 * SESSİZ KIRPMA YASAK: kullanıcı, elindeki tablonun tamamı sandığı şeyin bir
 * parçası olduğunu GÖRMELİDİR — aksi hâlde "toplam alacak" diye sunduğu rakam
 * ilk 500 müvekkilin toplamı olur.
 */
export function applyRowLimit<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean; total: number } {
  if (rows.length <= limit) return { rows, truncated: false, total: rows.length };
  return { rows: rows.slice(0, limit), truncated: true, total: rows.length };
}

export interface FinishTableOptions {
  /**
   * SORGU KENDİ `LIMIT`'İNE DAYANDI MI.
   *
   * Denetim bulgusu 4: üç rapor sorguyu `take: min(limit, N)` ile kırpıp sonra
   * `finishTable(rows, limit)` çağırıyordu. `applyRowLimit` elindeki diziye
   * bakar; dizi zaten kırpılmış geldiği için `rows.length <= limit` çıkar ve
   * tablo "kırpılmadı" işaretlenirdi. 640 kaçırılmış süresi olan büro 500
   * satır görür, hiçbir uyarı almaz ve 140 kaçırılmış süreyi HİÇ görmezdi —
   * `applyRowLimit` sözleşmesinin ("SESSİZ KIRPMA YASAK") tam ihlali.
   *
   * Çağıran taraf sorguyu `limit + 1` ile çalıştırır ve dönen satır sayısı
   * `limit`i AŞIYORSA bu bayrağı geçer. O anda gerçek toplam BİLİNMEZ; bilinen
   * tek şey "daha fazlası var"dır ve uyarı bunu böyle söyler.
   */
  queryLimitReached?: boolean;
}

export function finishTable(
  table: Omit<ReportTable, "rows" | "truncated" | "totalRowCount">,
  rows: Record<string, ReportCell>[],
  limit: number,
  options: FinishTableOptions = {},
): ReportTable {
  const limited = applyRowLimit(rows, limit);
  if (options.queryLimitReached) {
    return {
      ...table,
      rows: limited.rows,
      truncated: true,
      totalRowCount: limited.rows.length,
      totalRowCountExact: false,
    };
  }
  return {
    ...table,
    rows: limited.rows,
    truncated: limited.truncated,
    totalRowCount: limited.total,
    totalRowCountExact: true,
  };
}

/**
 * `take` değeri: sorgu daima BİR FAZLA satır ister.
 *
 * Fazladan gelen satır atılır; varlığı "sınıra dayanıldı"nın kanıtıdır.
 * Sayma sorgusu (`count`) atmak ikinci bir tam tarama demek olurdu.
 */
export function takeWithProbe(limit: number): number {
  return limit + 1;
}

/** Satır sınırına takılan tablolar için standart uyarı metni. */
export function truncationWarning(table: ReportTable): string | undefined {
  if (!table.truncated) return undefined;
  if (table.totalRowCountExact === false) {
    return (
      `"${table.title}" tablosu satır sınırına takıldı: ${table.rows.length} satır gösteriliyor ` +
      "ve GERİDE DAHA FAZLASI VAR (gerçek toplam sayılmadı). Toplam ölçüler tüm kayıtlar " +
      "üzerinden hesaplanmıştır; kırpılan yalnız ayrıntı listesidir. Dönemi daraltın, süzgeç " +
      "uygulayın veya `limit` değerini artırın."
    );
  }
  return (
    `"${table.title}" tablosu ${table.totalRowCount} satırın ilk ${table.rows.length} satırını ` +
    "içeriyor. Toplam ölçüler TÜM satırlar üzerinden hesaplanmıştır; ayrıntı listesi kırpılmıştır. " +
    "Dönemi daraltın veya `limit` değerini artırın."
  );
}

/* ─────────────────────────────── Çeşitli ─────────────────────────────── */

export const ZERO_DEC = new Prisma.Decimal(0);

export function decOf(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(0);
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/** `bigint | number | null` → number (raw sorgu sayaçları). */
export function intOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** ISO tarih (yalnız gün) — rapor hücrelerinde `date` tipinin taşıyıcısı. */
export function isoDay(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

/** Dakika → "12,50" saat metni değil, SAYI (2 basamak) — CSV'de toplanabilsin. */
export function minutesToHoursNumber(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Decimal karşılaştırıcı — `Array.prototype.sort` sözleşmesine UYAR.
 *
 * `(a, b) => a.gte(b) ? -1 : 1` eşitlikte asla 0 dönmez; V8'in kararlı
 * sıralaması bunu bugün bağışlar ama sözleşme ihlali, aynı veride motor
 * sürümüne göre farklı sıra üretebilir (denetim bulgusu 24).
 */
export function compareDescending(a: Prisma.Decimal, b: Prisma.Decimal): number {
  return b.comparedTo(a);
}

/**
 * Gün başına indirilmiş iki tarih arasındaki TAM GÜN farkı.
 *
 * Ham `(a - b) / 86400000` saat bileşenine duyarlıdır: aynı gün 00:00 ve 14:30
 * vadeli iki fatura, yalnız saatleri yüzünden farklı yaş dilimine düşerdi
 * (denetim bulgusu 8). `Invoice.issueDate`/`dueDate` timestamp'tir; `ref` ise
 * UTC gün başıdır — iki tarafı da güne indirmeden karşılaştırmak yanlıştır.
 */
export function wholeDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}
