/**
 * MUHASEBE DIŞA AKTARIMI (Faz 6) — Luca ve Logo (Tiger/Go) muhasebe programlarına CSV.
 *
 * Her iki program da "fiş satırı" mantığıyla içe aktarır: tarih, hesap kodu, açıklama, borç, alacak.
 * Hesap kodları büro muhasebecisinin planına göre değişir; burada TDHP (Tekdüzen) varsayılanları
 * kullanılır ve `hesapPlani` ile ezilebilir. Sütun başlıkları programların içe aktarma şablonlarına
 * göre adlandırılmıştır; muhasebeci ilk aktarımda eşlemeyi doğrular (belge: docs/faz6).
 *
 * KVKK: müvekkil adı fiş açıklamasına girer (muhasebe için zorunlu); TCKN/VKN GİRMEZ.
 */

export type ExportFormat = "luca" | "logo";

export interface ExportEntry {
  date: Date;
  type: string;
  amount: string;
  currency: string;
  description: string | null;
  clientName: string | null;
  caseLabel: string | null;
  invoiceNo?: string | null;
  vatRate?: string | null;
}

/** TDHP varsayılan hesapları — büro muhasebecisi eşlemeyi değiştirebilir. */
export const DEFAULT_HESAP_PLANI: Record<string, { borc: string; alacak: string; ad: string }> = {
  TAHAKKUK: { borc: "120", alacak: "600", ad: "Alıcılar / Yurt içi satışlar (tahakkuk)" },
  TAHSILAT: { borc: "102", alacak: "120", ad: "Bankalar / Alıcılar (tahsilat)" },
  AVANS: { borc: "102", alacak: "340", ad: "Bankalar / Alınan sipariş avansları" },
  MASRAF: { borc: "770", alacak: "102", ad: "Genel yönetim giderleri / Bankalar" },
  HARC: { borc: "770", alacak: "102", ad: "Harç gideri / Bankalar" },
  VEKALET_UCRETI: { borc: "120", alacak: "600", ad: "Alıcılar / Vekâlet ücreti geliri" },
  DANISMANLIK: { borc: "120", alacak: "600", ad: "Alıcılar / Danışmanlık geliri" },
  IADE: { borc: "600", alacak: "102", ad: "Satış iadesi / Bankalar" },
};

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function trDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

function trAmount(v: string): string {
  return Number(v).toFixed(2).replace(".", ",");
}

/** Luca: noktalı virgül ayraçlı; Tarih;Fiş No;Hesap Kodu;Hesap Adı;Açıklama;Borç;Alacak;Döviz */
export function toLucaCsv(entries: ExportEntry[], hesapPlani = DEFAULT_HESAP_PLANI): string {
  const lines = ["Tarih;Fiş No;Hesap Kodu;Hesap Adı;Açıklama;Borç;Alacak;Döviz"];
  let fisNo = 0;
  for (const e of entries) {
    fisNo += 1;
    const plan = hesapPlani[e.type] ?? { borc: "789", alacak: "789", ad: "Diğer" };
    const aciklama = [e.type, e.clientName, e.caseLabel, e.invoiceNo ? `Fatura ${e.invoiceNo}` : null, e.description].filter(Boolean).join(" · ");
    lines.push([trDate(e.date), `NOM${String(fisNo).padStart(6, "0")}`, plan.borc, plan.ad, aciklama, trAmount(e.amount), "0,00", e.currency].map(csvCell).join(";"));
    lines.push([trDate(e.date), `NOM${String(fisNo).padStart(6, "0")}`, plan.alacak, plan.ad, aciklama, "0,00", trAmount(e.amount), e.currency].map(csvCell).join(";"));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Logo (Tiger/Go) muhasebe fişi içe aktarma: virgül ayraçlı, İngilizce başlık şablonu. */
export function toLogoCsv(entries: ExportEntry[], hesapPlani = DEFAULT_HESAP_PLANI): string {
  const lines = ["DATE,SLIP_NO,ACCOUNT_CODE,DESCRIPTION,DEBIT,CREDIT,CURRENCY,VAT_RATE"];
  let fisNo = 0;
  for (const e of entries) {
    fisNo += 1;
    const plan = hesapPlani[e.type] ?? { borc: "789", alacak: "789", ad: "Diğer" };
    const aciklama = [e.type, e.clientName, e.caseLabel, e.invoiceNo ? `Fatura ${e.invoiceNo}` : null, e.description].filter(Boolean).join(" · ");
    const cell = (v: string | number | null | undefined) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    lines.push([trDate(e.date), `NOM${String(fisNo).padStart(6, "0")}`, plan.borc, aciklama, Number(e.amount).toFixed(2), "0.00", e.currency, e.vatRate ?? ""].map(cell).join(","));
    lines.push([trDate(e.date), `NOM${String(fisNo).padStart(6, "0")}`, plan.alacak, aciklama, "0.00", Number(e.amount).toFixed(2), e.currency, e.vatRate ?? ""].map(cell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function renderExport(format: ExportFormat, entries: ExportEntry[]): { body: string; filename: string; contentType: string } {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "logo") return { body: toLogoCsv(entries), filename: `nomosos-logo-${stamp}.csv`, contentType: "text/csv; charset=utf-8" };
  return { body: toLucaCsv(entries), filename: `nomosos-luca-${stamp}.csv`, contentType: "text/csv; charset=utf-8" };
}
