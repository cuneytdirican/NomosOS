/**
 * CSV DIŞA AKTARIM — TÜRKÇE EXCEL İÇİN.
 *
 * KARARLAR VE GEREKÇELERİ:
 *
 * 1. UTF-8 BOM (`\uFEFF`) EKLENİR. Excel, BOM'suz dosyayı Windows-1254 sanır ve
 *    "İçtihat", "Süre", "Müvekkil" bozuk görünür. BOM tek başına 3 bayttır ve
 *    LibreOffice/Numbers/pandas hepsi görmezden gelir.
 *
 * 2. AYRAÇ NOKTALI VİRGÜLDÜR (`;`). Türkçe yerelde Excel ondalık ayracı VİRGÜLDÜR;
 *    virgülle ayrılmış bir dosyada "1.234,56" iki hücreye bölünür. Noktalı virgül
 *    Türkçe Excel'in beklediği "Liste ayırıcısı"dır.
 *
 * 3. SAYILAR TÜRKÇE BİÇİMDE YAZILIR (binlik `.`, ondalık `,`) ve TIRNAKSIZ
 *    bırakılır — böylece Excel onları METİN değil SAYI olarak alır, kullanıcı
 *    doğrudan toplam alabilir. Para birimi eki hücreye YAZILMAZ; ayrı bir
 *    "Para birimi" sütunu döner (aksi hâlde hücre metne düşerdi).
 *
 * 4. SATIR SONU CRLF (`\r\n`) — Excel'in beklediği biçim.
 *
 * 5. FORMÜL ENJEKSİYONU KAPISI: `=`, `+`, `-`, `@`, TAB veya CR ile başlayan
 *    METİN hücrelerinin başına tek tırnak konur. Müvekkil adı olarak
 *    `=HYPERLINK("http://…")` kaydedilmiş bir satır, CSV'yi açan avukatın
 *    makinesinde çalışan bir formüle dönüşürdü. Kapı YALNIZ metin/tarih
 *    sütunlarına uygulanır: negatif tutarlar (`-1.234,56`) sayı olarak kalmalıdır.
 *
 * PDF DIŞA AKTARIM BİLİNÇLİ OLARAK YAPILMADI:
 * Arayüz tarayıcının yazdırma diyaloğunu (Ctrl+P → PDF olarak kaydet) kullanır.
 * Sunucu tarafı PDF, headless tarayıcı ya da ağır bir çizim kütüphanesi
 * gerektirir; ikisi de bu fazda yeni bir bağımlılık ve yeni bir güvenlik yüzeyi
 * demektir. `ReportFormat.PDF` şemada mevcuttur ve denetim kaydı için ayrılmıştır;
 * uç eklendiğinde `format: "PDF"` ile aynı hatta yazılacaktır.
 */

import type { ReportCell, ReportColumn, ReportResult, ReportTable } from "./report-types";
import { formatTrDate } from "../common/dates";

export const CSV_SEPARATOR = ";";
export const CSV_NEWLINE = "\r\n";
export const CSV_BOM = "\uFEFF";

/** Formül enjeksiyonu başlangıç karakterleri. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * "1234.56" (Decimal string) → "1.234,56".
 * `Number` ÜZERİNDEN GEÇMEZ: büyük tutarlarda kuruş kaybını önlemek için saf
 * metin işlemi yapılır (money.ts `formatMoneyTr` ile aynı yaklaşım).
 */
export function trDecimal(value: string): string {
  const negative = value.startsWith("-");
  const abs = negative ? value.slice(1) : value;
  const [intPart, fracPart = ""] = abs.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}${fracPart ? `,${fracPart}` : ""}`;
}

function formatCell(value: ReportCell, column: ReportColumn): { text: string; numeric: boolean } {
  if (value === null || value === undefined) return { text: "", numeric: false };

  switch (column.type) {
    case "money":
      // Para daima STRING olarak taşınır ("1234.56").
      return { text: trDecimal(String(value)), numeric: true };
    case "percent":
      return { text: trDecimal(Number(value).toFixed(2)), numeric: true };
    case "number":
    case "minutes":
      return { text: trDecimal(String(value)), numeric: true };
    case "date": {
      // Hücreler ISO GÜN metni taşır (`isoDay`); Date nesnesi gelirse de
      // `String(...)` ISO çıktısı verir ve ayrıştırılabilir kalır.
      const date = new Date(String(value));
      return {
        text: Number.isNaN(date.getTime()) ? String(value) : formatTrDate(date),
        numeric: false,
      };
    }
    default:
      return { text: String(value), numeric: false };
  }
}

/** Alanı CSV kurallarına göre kaçırır; metin hücrelerinde formül kapısı uygular. */
function escapeField(text: string, numeric: boolean): string {
  const guarded = !numeric && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  const needsQuotes =
    guarded.includes(CSV_SEPARATOR) ||
    guarded.includes('"') ||
    guarded.includes("\n") ||
    guarded.includes("\r");
  return needsQuotes ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function csvRow(values: { text: string; numeric: boolean }[]): string {
  return values.map((v) => escapeField(v.text, v.numeric)).join(CSV_SEPARATOR);
}

function textRow(values: string[]): string {
  return csvRow(values.map((text) => ({ text, numeric: false })));
}

export interface CsvOptions {
  /** Dosyanın başına rapor künyesi (ad, dönem, üretim anı, uyarılar) yazılsın mı. */
  includeMeta?: boolean;
}

/**
 * Tek tabloyu CSV metnine çevirir.
 *
 * KÜNYE BLOĞU (`includeMeta`, varsayılan açık): raporun adı, dönemi ve
 * kapanış gününün dâhil olup olmadığı dosyanın İÇİNDE durur. Basılıp dosyaya
 * konan bir tabloda "hangi dönem, kapanış dâhil mi" sorusunun cevabı e-posta
 * gövdesinde kalmamalıdır. Veri hattına ham tablo gerekiyorsa `meta=false`.
 */
export function buildCsv(
  result: ReportResult,
  table: ReportTable,
  options: CsvOptions = {},
): string {
  const includeMeta = options.includeMeta !== false;
  const lines: string[] = [];

  if (includeMeta) {
    lines.push(textRow(["Rapor", result.name]));
    lines.push(textRow(["Tablo", table.title]));
    lines.push(textRow(["Dönem", result.period.label]));
    lines.push(
      textRow([
        "Kapanış günü",
        result.period.endInclusive ? "DÂHİL" : "HARİÇ",
      ]),
    );
    lines.push(textRow(["Üretim anı", result.generatedAt.toISOString()]));
    lines.push(textRow(["Kaynak", "NomosOS — tüm rakamlar veritabanından deterministik hesaplandı"]));
    if (table.definition) lines.push(textRow(["Tanım", table.definition]));
    if (table.truncated) {
      lines.push(
        textRow([
          "UYARI",
          `Satır sınırı uygulandı: ${table.rows.length} / ${table.totalRowCount ?? "?"} satır.`,
        ]),
      );
    }
    for (const warning of result.warnings ?? []) lines.push(textRow(["UYARI", warning]));
    for (const hidden of result.hiddenSections ?? []) {
      lines.push(textRow(["GİZLENDİ", hidden]));
    }
    lines.push("");
  }

  lines.push(textRow(table.columns.map((c) => c.label)));
  for (const row of table.rows) {
    lines.push(csvRow(table.columns.map((column) => formatCell(row[column.key] ?? null, column))));
  }

  return CSV_BOM + lines.join(CSV_NEWLINE) + CSV_NEWLINE;
}

/** `rapor-buro-ozet-20260801-20260831.csv` */
export function csvFileName(result: ReportResult, table: ReportTable): string {
  const stamp = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const safeTable = table.key.replace(/[^a-z0-9-]/gi, "");
  return `rapor-${result.key}-${safeTable}-${stamp(result.period.from)}-${stamp(result.period.to)}.csv`;
}

/**
 * `Content-Disposition` değeri.
 *
 * ASCII `filename` yedeği + RFC 5987 `filename*` birlikte verilir: dosya adı
 * yalnız ASCII karakter içerse bile eski tarayıcılar için yedek gerekir, ve
 * ileride Türkçe ad üretilirse `filename*` doğru çözülür.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
