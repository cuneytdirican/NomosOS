/**
 * FATURA PDF (Faz 3) — pdfkit, DejaVu Sans (Türkçe glifler: ş ğ İ ı ç ö ü).
 *
 * İki kullanım: (1) platform faturası NomosOS → büro (`InvoiceRecord`),
 * (2) büro faturası büro → müvekkil (`Invoice`). İkisi de aynı düzeni kullanır:
 * başlık, satıcı/alıcı, satırlar, ara toplam/indirim/KDV/toplam, not.
 *
 * Bu belge RESMÎ e-Fatura DEĞİLDİR (GİB gönderimi entegratör üzerinden ayrı
 * akıştır); "Bilgi amaçlı fatura dökümü" ibaresi taşır. Büro kendi antetini
 * yükleyebilene kadar sade metin düzeni.
 */

import PDFDocument from "pdfkit";
import { createRequire } from "node:module";

const require_ = createRequire(__filename);

function fontPath(name: "DejaVuSans.ttf" | "DejaVuSans-Bold.ttf"): string {
  return require_.resolve(`dejavu-fonts-ttf/ttf/${name}`);
}

export interface PdfParty {
  name: string;
  address?: string | null;
  taxNumber?: string | null;
  taxOffice?: string | null;
  email?: string | null;
}

export interface PdfLine {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  lineTotal: string;
}

export interface InvoicePdfData {
  title: string;
  documentLabel: string;
  number: string | null;
  issueDate: Date | string | null;
  dueDate?: Date | string | null;
  status: string;
  supplier: PdfParty;
  customer: PdfParty;
  lines: PdfLine[];
  subtotal: string;
  discount?: string | null;
  discountReason?: string | null;
  vatAmount: string;
  total: string;
  currency: string;
  note?: string | null;
  footer?: string | null;
}

const money = (v: string, cur: string) => `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const date = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-");

const STATUS_TR: Record<string, string> = {
  TASLAK: "Taslak",
  GONDERILDI: "Kesildi — ödeme bekliyor",
  KISMI_ODENDI: "Kısmen ödendi",
  ODENDI: "Ödendi",
  IPTAL: "İptal",
  IADE: "İade",
};

export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: data.title, Author: "NomosOS" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("Sans", fontPath("DejaVuSans.ttf"));
    doc.registerFont("SansBold", fontPath("DejaVuSans-Bold.ttf"));
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // Başlık
    doc.font("SansBold").fontSize(18).text(data.title, left, 48);
    doc.font("Sans").fontSize(9).fillColor("#555").text(data.documentLabel, left, doc.y + 2);
    doc.fillColor("#000");
    const headTop = 48;
    doc.font("Sans").fontSize(10);
    const meta = [
      ["Fatura No", data.number ?? "(numarasız taslak)"],
      ["Tarih", date(data.issueDate)],
      ["Vade", date(data.dueDate)],
      ["Durum", STATUS_TR[data.status] ?? data.status],
    ];
    meta.forEach(([k, v], i) => {
      doc.font("SansBold").text(`${k}: `, right - 220, headTop + i * 14, { continued: true, width: 220 });
      doc.font("Sans").text(v);
    });

    // Taraflar
    let y = Math.max(doc.y, headTop + 14 * meta.length) + 20;
    const party = (label: string, p: PdfParty, x: number) => {
      doc.font("SansBold").fontSize(10).text(label, x, y, { width: width / 2 - 10 });
      doc.font("Sans").fontSize(10).text(p.name, x, doc.y + 2, { width: width / 2 - 10 });
      const extra = [p.address, p.taxNumber ? `VKN/TCKN: ${p.taxNumber}${p.taxOffice ? ` · ${p.taxOffice}` : ""}` : null, p.email].filter(Boolean) as string[];
      doc.fontSize(9).fillColor("#333");
      for (const line of extra) doc.text(line, x, doc.y + 1, { width: width / 2 - 10 });
      doc.fillColor("#000");
      return doc.y;
    };
    const y1 = party("Satıcı", data.supplier, left);
    const yTop = y;
    y = yTop;
    const y2 = party("Alıcı", data.customer, left + width / 2 + 10);
    y = Math.max(y1, y2) + 18;

    // Satır tablosu
    const cols = [
      { key: "description", label: "Açıklama", w: width * 0.46, align: "left" as const },
      { key: "quantity", label: "Miktar", w: width * 0.11, align: "right" as const },
      { key: "unitPrice", label: "Birim fiyat", w: width * 0.15, align: "right" as const },
      { key: "vatRate", label: "KDV %", w: width * 0.1, align: "right" as const },
      { key: "lineTotal", label: "Tutar", w: width * 0.18, align: "right" as const },
    ];
    doc.rect(left, y, width, 18).fill("#f1f5f9").fillColor("#000");
    let x = left + 4;
    doc.font("SansBold").fontSize(9);
    for (const c of cols) {
      doc.text(c.label, x, y + 5, { width: c.w - 8, align: c.align });
      x += c.w;
    }
    y += 22;
    doc.font("Sans").fontSize(9);
    for (const line of data.lines) {
      const cells: Record<string, string> = {
        description: line.description,
        quantity: Number(line.quantity).toLocaleString("tr-TR", { maximumFractionDigits: 2 }),
        unitPrice: money(line.unitPrice, data.currency),
        vatRate: `%${Number(line.vatRate).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`,
        lineTotal: money(line.lineTotal, data.currency),
      };
      const h = Math.max(14, doc.heightOfString(cells.description, { width: cols[0].w - 8 }) + 4);
      if (y + h > doc.page.height - 120) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      x = left + 4;
      for (const c of cols) {
        doc.text(cells[c.key], x, y, { width: c.w - 8, align: c.align });
        x += c.w;
      }
      y += h;
      doc.moveTo(left, y - 2).lineTo(right, y - 2).strokeColor("#e2e8f0").stroke();
    }

    // Toplamlar
    y += 8;
    const totals: Array<[string, string, boolean]> = [["Ara toplam (KDV hariç)", money(data.subtotal, data.currency), false]];
    if (data.discount && Number(data.discount) > 0) totals.push([`İndirim${data.discountReason ? ` (${data.discountReason})` : ""}`, `- ${money(data.discount, data.currency)}`, false]);
    totals.push(["KDV", money(data.vatAmount, data.currency), false]);
    totals.push(["GENEL TOPLAM", money(data.total, data.currency), true]);
    for (const [label, value, bold] of totals) {
      doc.font(bold ? "SansBold" : "Sans").fontSize(bold ? 11 : 10);
      doc.text(label, right - 300, y, { width: 180, align: "right" });
      doc.text(value, right - 116, y, { width: 116, align: "right" });
      y += bold ? 18 : 14;
    }

    if (data.note) {
      y += 10;
      doc.font("SansBold").fontSize(9).text("Not", left, y);
      doc.font("Sans").fontSize(9).text(data.note, left, doc.y + 2, { width });
    }

    // Alt bilgi
    const footer = data.footer ?? "Bu belge NomosOS tarafından üretilmiş bilgi amaçlı fatura dökümüdür; resmî e-Fatura/e-Arşiv belgesi GİB entegratörü üzerinden düzenlenir.";
    doc.font("Sans").fontSize(8).fillColor("#666").text(footer, left, doc.page.height - 80, { width, align: "center" });
    doc.end();
  });
}

/** Platform faturası (NomosOS → büro). */
export function renderPlatformInvoicePdf(input: {
  invoice: {
    number: string | null;
    type: string;
    description: string | null;
    issueDate: Date | string | null;
    dueDate: Date | string | null;
    status: string;
    listAmount: string;
    discountAmount: string;
    amount: string;
    vatAmount: string;
    total: string;
    currency: string;
    meta: Record<string, unknown>;
  };
  tenant: PdfParty;
}): Promise<Buffer> {
  const inv = input.invoice;
  const typeLabel = inv.type === "ABONELIK" ? "Abonelik dönem faturası" : inv.type === "PLAN_FARKI" ? "Plan farkı faturası" : "Kredi paketi faturası";
  return renderInvoicePdf({
    title: "NomosOS Fatura",
    documentLabel: typeLabel,
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    status: inv.status,
    supplier: { name: process.env.PLATFORM_LEGAL_NAME?.trim() || "NomosOS — MindAeon AI", address: process.env.PLATFORM_LEGAL_ADDRESS?.trim() || null, taxNumber: process.env.PLATFORM_TAX_NUMBER?.trim() || null, taxOffice: process.env.PLATFORM_TAX_OFFICE?.trim() || null },
    customer: input.tenant,
    lines: [{ description: inv.description ?? typeLabel, quantity: "1", unitPrice: inv.listAmount, vatRate: "20", lineTotal: inv.listAmount }],
    subtotal: inv.listAmount,
    discount: inv.discountAmount,
    discountReason: typeof inv.meta.discountReason === "string" ? inv.meta.discountReason : null,
    vatAmount: inv.vatAmount,
    total: inv.total,
    currency: inv.currency,
    note: inv.status === "ODENDI" ? "Ödeme alınmıştır; teşekkür ederiz." : "Ödemeyi Ayarlar → Abonelik ekranından çevrimiçi yapabilir ya da havale/EFT ile gönderip dekontu iletebilirsiniz.",
  });
}
