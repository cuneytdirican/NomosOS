/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  UBL-TR 1.2 ALAN EŞLEMESİ (NomosOS → e-Fatura / e-Arşiv)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bu dosya, NomosOS `Invoice` / `InvoiceLine` / `Client` kayıtlarının GİB
 * UBL-TR 1.2 şemasındaki karşılıklarını BELGELER ve sağlayıcıya verilecek
 * yükü üretir. XML burada üretilmez: XML/zarf (Zarf, ETTN, imza) sorumluluğu
 * özel entegratöründür; NomosOS sağlayıcı-bağımsız bir JSON yük verir.
 *
 * ┌──────────────────────────────┬──────────────────────────────────────────┐
 * │ UBL-TR yolu                  │ NomosOS kaynağı                          │
 * ├──────────────────────────────┼──────────────────────────────────────────┤
 * │ Invoice/cbc:UBLVersionID     │ sabit "2.1" (entegratör ekler)           │
 * │ Invoice/cbc:CustomizationID  │ sabit "TR1.2" (entegratör ekler)         │
 * │ Invoice/cbc:ProfileID        │ E_FATURA→TEMELFATURA, E_ARSIV→EARSIV…    │
 * │ Invoice/cbc:ID               │ Invoice.invoiceNo (16 hane: SSS+YYYY+9)  │
 * │ Invoice/cbc:UUID             │ Invoice.eInvoiceUuid (ETTN)              │
 * │ Invoice/cbc:IssueDate        │ Invoice.issueDate (YYYY-MM-DD, UTC)      │
 * │ Invoice/cbc:IssueTime        │ Invoice.issueDate (hh:mm:ss, UTC)        │
 * │ Invoice/cbc:InvoiceTypeCode  │ SATIS (iade faturasında IADE)            │
 * │ Invoice/cbc:DocumentCurrency │ Invoice.currency (TRY/USD/EUR)           │
 * │ Invoice/cbc:Note             │ Invoice.note                             │
 * │ cac:AccountingSupplierParty  │ Tenant (büro) — ad/VKN/vergi dairesi     │
 * │   …/cac:PartyIdentification  │   schemeID="VKN", Tenant.taxNumber       │
 * │ cac:AccountingCustomerParty  │ Client                                   │
 * │   …/cac:PartyIdentification  │   Tüzel: schemeID="VKN" Client.taxNumber │
 * │                              │   Gerçek: schemeID="TCKN" Client.tckn    │
 * │   …/cac:PartyTaxScheme       │   Client.taxOffice                       │
 * │   …/cac:PostalAddress        │   Client.address                         │
 * │   …/cac:Contact              │   Client.email / Client.phone            │
 * │ cac:PaymentTerms/cbc:…DueDate│ Invoice.dueDate                          │
 * │ cac:InvoiceLine/cbc:ID       │ satır sırası (1..n)                      │
 * │   …/cbc:InvoicedQuantity     │ InvoiceLine.quantity                     │
 * │       @unitCode              │ TIME_ENTRY→"HUR" (saat), diğer→"C62"     │
 * │   …/cbc:LineExtensionAmount  │ InvoiceLine.lineTotal                    │
 * │   …/cac:Item/cbc:Name        │ InvoiceLine.description                  │
 * │   …/cac:Price/cbc:PriceAmount│ InvoiceLine.unitPrice                    │
 * │   …/cac:TaxTotal/cbc:TaxAmt  │ satır KDV'si (invoice-math)              │
 * │   …/…/cac:TaxSubtotal/       │                                          │
 * │       cbc:Percent            │ InvoiceLine.vatRate                      │
 * │       TaxScheme/cbc:Name     │ "KDV", TaxTypeCode "0015"                │
 * │ cac:TaxTotal (belge)         │ Invoice.vatAmount                        │
 * │   …/cac:TaxSubtotal          │ oran bazlı kırılım (invoice-math)        │
 * │ cac:LegalMonetaryTotal       │                                          │
 * │   …/cbc:LineExtensionAmount  │ Invoice.subtotal                         │
 * │   …/cbc:TaxExclusiveAmount   │ Invoice.subtotal                         │
 * │   …/cbc:TaxInclusiveAmount   │ Invoice.total                            │
 * │   …/cbc:PayableAmount        │ Invoice.total                            │
 * └──────────────────────────────┴──────────────────────────────────────────┘
 *
 * KAPSAM DIŞI (bilerek yapılmadı, uydurulmadı):
 *   • Stopaj / tevkifat (`cac:WithholdingTaxTotal`) — serbest meslek makbuzu
 *     senaryosu için oran alanı henüz şemada yok.
 *   • İstisna kodları (`cbc:TaxExemptionReasonCode`).
 *   • Döviz kuru (`cbc:CalculationRate`) — kur alanı şemada yok, kur uydurulmaz.
 *   • İrsaliye/sipariş referansları.
 * Bu alanlar entegratör bağlandığında şema genişletilerek eklenmelidir.
 */

import type { Prisma } from "@nomosos/db";
import { moneyOut, rateOut } from "../../finance/money";
import type { UblInvoiceLine, UblInvoicePayload, UblParty } from "./e-invoice.types";

export interface UblSourceInvoice {
  id: string;
  invoiceNo: string | null;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  subtotal: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  note: string | null;
  eInvoiceUuid: string | null;
  lines: {
    description: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    vatRate: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    sourceType: string | null;
  }[];
}

export interface UblSourceClient {
  type: string;
  name: string;
  tckn: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

export interface UblSourceTenant {
  name: string;
  taxNumber?: string | null;
  taxOffice?: string | null;
  address?: string | null;
}

/** UTC gün/saat — fatura tarihi sunucu saat dilimine göre kaymasın. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function isoTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}

/**
 * Alıcı kimlik numarası seçimi.
 * Tüzel kişi → VKN (10 hane), gerçek kişi → TCKN (11 hane).
 * İkisi de yoksa `null` döner ve gönderim öncesi doğrulama bunu 400 ile yakalar.
 */
export function resolveCustomerIdentification(client: UblSourceClient): UblParty["identification"] {
  const vkn = client.taxNumber?.replace(/\D/g, "") ?? "";
  const tckn = client.tckn?.replace(/\D/g, "") ?? "";
  if (vkn.length === 10) return { schemeId: "VKN", value: vkn };
  if (tckn.length === 11) return { schemeId: "TCKN", value: tckn };
  return null;
}

export function buildUblInvoicePayload(args: {
  invoice: UblSourceInvoice;
  client: UblSourceClient;
  tenant: UblSourceTenant;
  /** Mükellef sorgusu sonucu; e-Fatura mükellefi değilse e-Arşiv kesilir. */
  documentKind: "E_FATURA" | "E_ARSIV";
  uuid: string;
  vatBreakdown: { vatRate: Prisma.Decimal; taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal }[];
}): UblInvoicePayload {
  const { invoice, client, tenant, documentKind, uuid, vatBreakdown } = args;

  const lines: UblInvoiceLine[] = invoice.lines.map((line, index) => {
    const lineVat = line.lineTotal.mul(line.vatRate).div(100);
    return {
      id: String(index + 1),
      quantity: line.quantity.toFixed(2),
      // Zaman kaydından gelen satır saat (HUR), diğerleri adet (C62).
      unitCode: line.sourceType === "TIME_ENTRY" ? "HUR" : "C62",
      itemName: line.description,
      unitPrice: moneyOut(line.unitPrice),
      lineExtensionAmount: moneyOut(line.lineTotal),
      taxRatePercent: rateOut(line.vatRate),
      taxAmount: moneyOut(lineVat),
    };
  });

  return {
    uuid,
    invoiceNumber: invoice.invoiceNo,
    issueDate: isoDate(invoice.issueDate),
    issueTime: isoTime(invoice.issueDate),
    invoiceTypeCode: "SATIS",
    documentKind,
    profileId: documentKind === "E_ARSIV" ? "EARSIVFATURA" : "TEMELFATURA",
    currencyCode: invoice.currency,
    supplier: {
      identification: tenant.taxNumber ? { schemeId: "VKN", value: tenant.taxNumber } : null,
      name: tenant.name,
      taxOffice: tenant.taxOffice ?? undefined,
      address: tenant.address ?? undefined,
    },
    customer: {
      identification: resolveCustomerIdentification(client),
      name: client.name,
      taxOffice: client.taxOffice ?? undefined,
      address: client.address ?? undefined,
      email: client.email ?? undefined,
      phone: client.phone ?? undefined,
    },
    lines,
    taxSubtotals: vatBreakdown.map((b) => ({
      taxRatePercent: rateOut(b.vatRate),
      taxableAmount: moneyOut(b.taxableAmount),
      taxAmount: moneyOut(b.taxAmount),
    })),
    legalMonetaryTotal: {
      lineExtensionAmount: moneyOut(invoice.subtotal),
      taxExclusiveAmount: moneyOut(invoice.subtotal),
      taxInclusiveAmount: moneyOut(invoice.total),
      payableAmount: moneyOut(invoice.total),
    },
    note: invoice.note ?? undefined,
    dueDate: invoice.dueDate ? isoDate(invoice.dueDate) : undefined,
  };
}
