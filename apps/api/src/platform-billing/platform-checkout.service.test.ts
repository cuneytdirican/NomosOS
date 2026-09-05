/**
 * Checkout + kesinleştirme — sahte Prisma ile: kredi paketi (SIMULASYON anında yükleme),
 * abonelik faturası (dönem ilerletme), idempotent settle, tutar uyuşmazlığı reddi,
 * sağlayıcı yokken 503, elle ödendi işaretleme.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@nomosos/db";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { PlatformAuditService } from "../platform/platform-audit.service";
import type { CreditService } from "../credits/credit.service";
import { OdemeSaglayici } from "../billing/odeme-saglayici";
import type { CouponService } from "./coupon.service";
import { PlatformCheckoutService } from "./platform-checkout.service";

const D = (v: string | number) => new Prisma.Decimal(v);
const USER = { userId: "u1", tenantId: "t1", role: "PARTNER" as const };

function buildDb() {
  const invoices = new Map<string, Record<string, unknown>>();
  const payments = new Map<string, Record<string, unknown>>();
  let subscription: Record<string, unknown> = {
    id: "s1",
    tenantId: "t1",
    status: "ACTIVE",
    currentPeriodStart: new Date("2026-08-05T00:00:00Z"),
    currentPeriodEnd: new Date("2026-09-05T00:00:00Z"),
    trialEndsAt: null,
  };
  let seq = 0;
  const tx = {
    invoiceRecord: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => (where?.id ? invoices.get(where.id) ?? null : null)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `inv-${++seq}`, ...data, paidAt: null };
        invoices.set(row.id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => invoices.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...invoices.get(where.id), ...data };
        invoices.set(where.id, row);
        return row;
      }),
    },
    paymentRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `pay-${++seq}`, providerRef: null, providerPayload: null, paidAt: null, ...data };
        payments.set(row.id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; checkoutToken?: string } }) => {
        const row = where.id ? payments.get(where.id) : [...payments.values()].find((p) => p.checkoutToken === where.checkoutToken);
        if (!row) return null;
        return { ...row, invoiceRecord: invoices.get(row.invoiceRecordId as string) ?? null };
      }),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...payments.get(where.id), ...data };
        payments.set(where.id, row);
        return row;
      }),
    },
    subscription: {
      findUnique: vi.fn(async () => subscription),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        subscription = { ...subscription, ...data };
        return subscription;
      }),
    },
    coupon: { updateMany: vi.fn(async () => ({ count: 1 })) },
    creditPackage: { findUnique: vi.fn(async () => ({ key: "EK_500", credits: 500, price: D("400.00"), currency: "TRY", isActive: true })) },
    creditWallet: { findUnique: vi.fn(async () => ({ tenantId: "t1" })) },
    tenant: { findUnique: vi.fn(async () => ({ name: "Demo Hukuk", address: "Ankara", taxNumber: "1234567890" })) },
    user: { findUnique: vi.fn(async () => ({ fullName: "Av. Demo Partner", email: "partner@demo" })) },
  };
  const prisma = { client: { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } } as unknown as PrismaService;
  return { prisma, invoices, payments, get subscription() { return subscription; } };
}

function build(mode: "SIMULASYON" | "YOK" = "SIMULASYON") {
  process.env.ODEME_SAGLAYICI = mode;
  const db = buildDb();
  const loadPaidPackage = vi.fn(async () => ({}));
  const credits = { loadPaidPackage } as unknown as CreditService;
  const coupons = { requireValid: vi.fn(async () => ({ code: "KREDI20", kind: "YUZDE", value: D(20) })), redeem: vi.fn(async () => undefined) } as unknown as CouponService;
  const audit = { log: vi.fn(async () => undefined) } as unknown as AuditService;
  const platformAudit = { log: vi.fn(async () => undefined) } as unknown as PlatformAuditService;
  const svc = new PlatformCheckoutService(db.prisma, new OdemeSaglayici(), credits, coupons, audit, platformAudit);
  return { svc, db, loadPaidPackage, coupons };
}

const ORIGINAL = process.env.ODEME_SAGLAYICI;
beforeEach(() => {
  process.env.WEB_ORIGIN = "http://web";
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ODEME_SAGLAYICI;
  else process.env.ODEME_SAGLAYICI = ORIGINAL;
});

describe("PlatformCheckoutService — kredi paketi", () => {
  it("SIMULASYON: fatura GONDERILDI → ödeme BASARILI → fatura ODENDI → krediler YÜKLENİR (ödeme kesinleşince); kupon uygulanır ve tüketilir", async () => {
    const b = build();
    const res = await b.svc.startCreditPurchase(USER, "EK_500", "KREDI20", "1.1.1.1");
    expect(res.odendi).toBe(true);
    expect(res.odemeSayfasi).toBeNull();
    expect(res.fatura.status).toBe("ODENDI");
    expect(res.fatura.type).toBe("KREDI_PAKETI");
    expect(res.fatura.amount).toBe("320.00"); // 400 − %20
    expect(res.fatura.total).toBe("384.00");
    expect(res.fatura.number).toMatch(/^NOM-\d{4}-\d{6}$/);
    expect(b.loadPaidPackage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: "t1", packageKey: "EK_500", credits: 500, total: "384.00" }));
    expect((b.coupons.redeem as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const payment = [...b.db.payments.values()][0];
    expect(payment.status).toBe("BASARILI");
    expect(String(payment.providerRef)).toMatch(/^SIM-/);
  });

  it("sağlayıcı yoksa 503 — kredi yüklenmez, ödeme BEKLIYOR kalır", async () => {
    const b = build("YOK");
    await expect(b.svc.startCreditPurchase(USER, "EK_500", null, "ip")).rejects.toThrow("yapılandırılmadı");
    expect(b.loadPaidPackage).not.toHaveBeenCalled();
    expect([...b.db.payments.values()][0]?.status).toBe("BEKLIYOR");
  });

  it("rol: AVUKAT satın alamaz", async () => {
    const b = build();
    await expect(b.svc.startCreditPurchase({ ...USER, role: "AVUKAT" }, "EK_500", null, "ip")).rejects.toThrow();
  });
});

describe("PlatformCheckoutService — abonelik faturası + settle", () => {
  it("dönem faturası ödenince abonelik dönemi ilerler ve ACTIVE olur; ikinci settle idempotent", async () => {
    const b = build();
    const inv = await b.db.prisma.client.invoiceRecord.create({
      data: { tenantId: "t1", type: "ABONELIK", number: "NOM-2026-000009", status: "GONDERILDI", amount: D(6000), vatAmount: D(1200), total: D(7200), discountAmount: D(0), couponCode: null, periodStart: new Date("2026-09-05T00:00:00Z"), periodEnd: new Date("2026-10-05T00:00:00Z"), issueDate: new Date(), metaJson: null },
    });
    const res = await b.svc.startInvoicePayment(USER, inv.id as string, "ip");
    expect(res.odendi).toBe(true);
    expect(b.db.subscription.status).toBe("ACTIVE");
    expect((b.db.subscription.currentPeriodEnd as Date).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    const payId = [...b.db.payments.keys()][0];
    const again = await b.svc.settle(payId, { ref: "x", method: "SIMULASYON" });
    expect(again.yeni).toBe(false);
    expect(b.loadPaidPackage).not.toHaveBeenCalled();
  });

  it("tutar uyuşmazlığı: ödeme BASARISIZ, fatura ödenmez", async () => {
    const b = build();
    const inv = await b.db.prisma.client.invoiceRecord.create({
      data: { tenantId: "t1", type: "KREDI_PAKETI", number: "NOM-2026-000010", status: "GONDERILDI", amount: D(400), vatAmount: D(80), total: D(480), discountAmount: D(0), couponCode: null, periodStart: null, periodEnd: null, issueDate: new Date(), metaJson: JSON.stringify({ packageKey: "EK_500", credits: 500 }) },
    });
    const pay = await b.db.prisma.client.paymentRecord.create({ data: { tenantId: "t1", invoiceRecordId: inv.id, amount: D(480), currency: "TRY", status: "BEKLIYOR", checkoutToken: "ct" } });
    await expect(b.svc.settle(pay.id as string, { ref: "r", method: "IYZICO", paidPrice: "100.00", currency: "TRY" })).rejects.toThrow("uyuşmuyor");
    expect(b.db.payments.get(pay.id as string)?.status).toBe("BASARISIZ");
    expect(b.db.invoices.get(inv.id as string)?.status).toBe("GONDERILDI");
    expect(b.loadPaidPackage).not.toHaveBeenCalled();
  });

  it("ödenmiş fatura tekrar ödenemez (409); elle ödendi işaretleme kesinleştirir", async () => {
    const b = build();
    const inv = await b.db.prisma.client.invoiceRecord.create({
      data: { tenantId: "t1", type: "ABONELIK", number: "NOM-2026-000011", status: "GONDERILDI", amount: D(6000), vatAmount: D(1200), total: D(7200), discountAmount: D(0), couponCode: null, periodStart: new Date("2026-09-05T00:00:00Z"), periodEnd: new Date("2026-10-05T00:00:00Z"), issueDate: new Date(), metaJson: null },
    });
    const actor = { id: "pu1", role: "BILLING_ADMIN" } as never;
    const r = await b.svc.markPaidManual(actor, inv.id as string, { method: "HAVALE", reference: "DEKONT-1" });
    expect(r.fatura.status).toBe("ODENDI");
    await expect(b.svc.startInvoicePayment(USER, inv.id as string, "ip")).rejects.toThrow("ödenebilir durumda değil");
    await expect(b.svc.markPaidManual(actor, inv.id as string, { method: "HAVALE", reference: "DEKONT-2" })).rejects.toThrow("zaten ödenmiş");
  });
});
