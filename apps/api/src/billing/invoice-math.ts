/**
 * FATURA TUTAR HESABI — TEK DOĞRULUK KAYNAĞI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ İSTEMCİDEN GELEN HİÇBİR TOPLAMA GÜVENİLMEZ. Fatura ara toplamı, KDV'si   ║
 * ║ ve genel toplamı DAİMA burada, satırlardan yeniden hesaplanır.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ALGORİTMA (deterministik, Prisma.Decimal):
 *
 *   satırTutarı  = yuvarla2( miktar × birimFiyat )              [HALF_UP]
 *   satırKDV     = yuvarla2( satırTutarı × kdvOranı / 100 )     [HALF_UP]
 *   araToplam    = Σ satırTutarı
 *   kdvToplamı   = Σ satırKDV
 *   genelToplam  = araToplam + kdvToplamı
 *
 * NEDEN SATIR BAZINDA YUVARLAMA?
 *   Bir faturada farklı KDV oranlı satırlar bulunabilir (vekâlet ücreti %20,
 *   harç yansıtması %0). Oran bazlı KDV matrahı ancak satır satır yuvarlanmış
 *   değerlerden çıkarılabilir; önce toplayıp sonra yuvarlamak, e-Fatura'nın
 *   `cac:TaxSubtotal` kırılımıyla kuruş farkı üretir ve GİB tarafında reddedilir.
 *   Ayrıca kullanıcı satırları elle topladığında ekrandaki toplamla birebir tutar.
 *
 * KDV ORANI KODA GÖMÜLÜ DEĞİLDİR: her satır kendi `vatRate` alanını taşır ve
 * oran ücret sözleşmesinden okunur (bkz. money.ts → `defaultVatRate`).
 */

import { Prisma } from "@nomosos/db";
import { applyPercent, dec, roundMoney, roundQuantity, type MoneyLike } from "../finance/money";

export interface InvoiceLineInput {
  description: string;
  quantity: MoneyLike;
  unitPrice: MoneyLike;
  /** Yüzde olarak KDV oranı (20 = %20). */
  vatRate: MoneyLike;
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface ComputedInvoiceLine {
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  lineVat: Prisma.Decimal;
  sourceType: string | null;
  sourceId: string | null;
}

export interface InvoiceTotals {
  lines: ComputedInvoiceLine[];
  subtotal: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  /** e-Fatura `cac:TaxSubtotal` kırılımı: oran → matrah + vergi. */
  vatBreakdown: { vatRate: Prisma.Decimal; taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal }[];
}

export function computeInvoiceTotals(inputs: readonly InvoiceLineInput[]): InvoiceTotals {
  const lines: ComputedInvoiceLine[] = inputs.map((input) => {
    const quantity = roundQuantity(input.quantity);
    const unitPrice = roundMoney(input.unitPrice);
    const vatRate = dec(input.vatRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const lineTotal = roundMoney(quantity.mul(unitPrice));
    const lineVat = applyPercent(lineTotal, vatRate);
    return {
      description: input.description,
      quantity,
      unitPrice,
      vatRate,
      lineTotal,
      lineVat,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
    };
  });

  const subtotal = lines.reduce((acc, l) => acc.plus(l.lineTotal), new Prisma.Decimal(0));
  const vatAmount = lines.reduce((acc, l) => acc.plus(l.lineVat), new Prisma.Decimal(0));

  const breakdownMap = new Map<string, { vatRate: Prisma.Decimal; taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal }>();
  for (const line of lines) {
    const key = line.vatRate.toFixed(2);
    const bucket = breakdownMap.get(key) ?? {
      vatRate: line.vatRate,
      taxableAmount: new Prisma.Decimal(0),
      taxAmount: new Prisma.Decimal(0),
    };
    bucket.taxableAmount = bucket.taxableAmount.plus(line.lineTotal);
    bucket.taxAmount = bucket.taxAmount.plus(line.lineVat);
    breakdownMap.set(key, bucket);
  }

  return {
    lines,
    subtotal,
    vatAmount,
    total: subtotal.plus(vatAmount),
    vatBreakdown: [...breakdownMap.values()].sort((a, b) => a.vatRate.comparedTo(b.vatRate)),
  };
}

/**
 * Ödeme durumu çözümü.
 *
 * `paid >= total`  → ODENDI  (eşitlik dâhil; fazla ödeme ayrıca uyarılır)
 * `0 < paid < total` → KISMI_ODENDI
 * `paid == 0`      → GONDERILDI (kesilmiş ama tahsil edilmemiş)
 */
export function resolvePaymentStatus(
  total: Prisma.Decimal,
  paid: Prisma.Decimal,
): { status: "GONDERILDI" | "KISMI_ODENDI" | "ODENDI"; remaining: Prisma.Decimal; overpaid: Prisma.Decimal } {
  const remaining = total.minus(paid);
  if (paid.lte(0)) {
    return { status: "GONDERILDI", remaining: total, overpaid: new Prisma.Decimal(0) };
  }
  if (paid.gte(total)) {
    return {
      status: "ODENDI",
      remaining: new Prisma.Decimal(0),
      overpaid: paid.minus(total),
    };
  }
  return { status: "KISMI_ODENDI", remaining, overpaid: new Prisma.Decimal(0) };
}
