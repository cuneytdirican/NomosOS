import { describe, expect, it } from "vitest";
import { renderInvoicePdf, renderPlatformInvoicePdf } from "./invoice-pdf";

describe("invoice-pdf", () => {
  it("geçerli PDF üretir (Türkçe karakterli metinle, DejaVu Sans)", async () => {
    const buf = await renderInvoicePdf({
      title: "Yılmaz & Şahin Hukuk Bürosu",
      documentLabel: "Avukatlık hizmeti faturası",
      number: "NOM2026000001",
      issueDate: new Date("2026-09-05T00:00:00Z"),
      dueDate: new Date("2026-09-20T00:00:00Z"),
      status: "GONDERILDI",
      supplier: { name: "Yılmaz & Şahin Hukuk Bürosu", address: "Çankaya/Ankara", taxNumber: "1234567890", taxOffice: "Çankaya" },
      customer: { name: "Öz Metal San. A.Ş.", taxNumber: "9876543210" },
      lines: [
        { description: "İşe iade davası — danışmanlık (İğdır Asliye)", quantity: "3.50", unitPrice: "1500.00", vatRate: "20", lineTotal: "5250.00" },
        { description: "Dilekçe hazırlama", quantity: "1", unitPrice: "2000.00", vatRate: "20", lineTotal: "2000.00" },
      ],
      subtotal: "7250.00",
      vatAmount: "1450.00",
      total: "8700.00",
      currency: "TRY",
      note: "Ödeme 15 gün içinde.",
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);
    expect(buf.toString("latin1")).toMatch(/DejaVuSans/);
  });

  it("platform faturası: indirim satırı ve ödendi notu", async () => {
    const buf = await renderPlatformInvoicePdf({
      invoice: {
        number: "NOM-2026-000003",
        type: "ABONELIK",
        description: "Büro planı · 5 kullanıcı · aylık dönem",
        issueDate: new Date(),
        dueDate: new Date(),
        status: "ODENDI",
        listAmount: "6000.00",
        discountAmount: "1800.00",
        amount: "4200.00",
        vatAmount: "840.00",
        total: "5040.00",
        currency: "TRY",
        meta: { discountReason: "BYO-LLM indirimi %30" },
      },
      tenant: { name: "Demo Hukuk Bürosu", address: "İstanbul", taxNumber: "1112223334", taxOffice: "Beşiktaş" },
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
