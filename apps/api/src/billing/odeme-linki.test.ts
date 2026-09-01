/**
 * E8 — PORTAL ÖDEME BAĞLANTISI testleri.
 *
 * Korunan taahhütler:
 *  1. Bağlantı kalan bakiyeyle sınırlı; tam ödenmiş faturaya bağlantı yok.
 *  2. Tek kullanımlık: ikinci ödeme 409.
 *  3. Sağlayıcı yapılandırılmadıysa DÜRÜST 503 (sahte "ödendi" yok).
 *  4. SIMULASYON modunda ödeme kaydı: Payment(ONLINE) + FinancialEntry + bağlantı ODENDI.
 *  5. Ödeme, bağlantı ile faturanın KÜÇÜK tutarı üzerinden yapılır (fazla ödeme yok).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { OdemeLinkiService } from "./odeme-linki.service";
import { OdemeSaglayici, odemeSaglayiciTuru } from "./odeme-saglayici";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { InvoicesService } from "./invoices.service";
import { Prisma } from "@nomosos/db";

const TENANT = "t-1";
const USER = { tenantId: TENANT, userId: "u-1", role: "ADMIN" } as never;

function invoiceFixture(over?: { total?: string; paid?: string[]; status?: string }) {
  return {
    id: "inv-1",
    tenantId: TENANT,
    invoiceNo: "NOM2026000001",
    status: over?.status ?? "KESINLESTI",
    total: new Prisma.Decimal(over?.total ?? "100000"),
    currency: "TRY",
    clientId: "c-1",
    client: { id: "c-1", name: "ABC A.Ş." },
    payments: (over?.paid ?? []).map((a) => ({ amount: new Prisma.Decimal(a) })),
  };
}

function serviceWith(over?: {
  invoice?: ReturnType<typeof invoiceFixture>;
  link?: Record<string, unknown> | null;
  paymentsSum?: string;
}) {
  const invoice = over?.invoice ?? invoiceFixture();
  const link =
    over?.link === undefined
      ? {
          id: "link-1",
          tenantId: TENANT,
          invoiceId: "inv-1",
          token: "a".repeat(64),
          amount: new Prisma.Decimal("100000"),
          currency: "TRY",
          status: "AKTIF",
          expiresAt: new Date(Date.now() + 86_400_000),
          paidAt: null,
          paidPaymentId: null,
        }
      : (over?.link as never);

  const created: Array<[string, Record<string, unknown>]> = [];
  const prisma = {
    client: {
      invoice: {
        findFirst: async () => invoice,
        findUnique: async () => invoice,
      },
      odemeLinki: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(["link", data]);
          return { id: "link-2", ...data };
        },
        findUnique: async () => link,
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const payments: { amount: Prisma.Decimal }[] = [];
        const tx = {
          $executeRaw: async () => 0,
          odemeLinki: {
            findUnique: async () => link,
            update: async ({ data }: { data: Record<string, unknown> }) => {
              created.push(["link-update", data]);
              return { id: "link-1", ...data };
            },
          },
          payment: {
            aggregate: async () => ({
              _sum: { amount: new Prisma.Decimal(over?.paymentsSum ?? "0") },
            }),
            create: async ({ data }: { data: Record<string, unknown> }) => {
              payments.push({ amount: data.amount as Prisma.Decimal });
              created.push(["payment", data]);
              return { id: "pay-1", ...data };
            },
          },
          financialEntry: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              created.push(["finans", data]);
              return { id: "fe-1", ...data };
            },
          },
        };
        return fn(tx);
      },
    },
  } as unknown as PrismaService;
  const audit = { log: async () => {} } as unknown as AuditService;
  const invoices = {
    recalcPaymentStatus: async () => ({ status: "ODENDI" }),
  } as unknown as InvoicesService;
  const saglayici = new OdemeSaglayici();
  const svc = new OdemeLinkiService(prisma, audit, invoices, saglayici);
  return { svc, created };
}

describe("Bağlantı üretimi", () => {
  it("kalan bakiyeyle sınırlı bağlantı üretilir; token 64 hex", async () => {
    const { svc, created } = serviceWith();
    const r = await svc.create(USER, "inv-1");
    expect(r.token).toMatch(/^[a-f0-9]{64}$/);
    expect(r.amount).toBe("100000.00"); // TL cinsinden Decimal (moneyOut)
    const linkCreate = created.find(([k]) => k === "link")?.[1] as Record<string, unknown>;
    expect(linkCreate.status).toBe("AKTIF");
  });

  it("tam ödenmiş faturaya bağlantı üretilemez (409)", async () => {
    const { svc } = serviceWith({ invoice: invoiceFixture({ paid: ["100000"] }) });
    await expect(svc.create(USER, "inv-1")).rejects.toThrow(ConflictException);
  });

  it("taslak faturaya bağlantı üretilemez", async () => {
    const { svc } = serviceWith({ invoice: invoiceFixture({ status: "TASLAK" }) });
    await expect(svc.create(USER, "inv-1")).rejects.toThrow(/Taslak/);
  });
});

describe("Ödeme — sağlayıcı sözleşmesi", () => {
  const ORIGINAL = process.env.ODEME_SAGLAYICI;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ODEME_SAGLAYICI;
    else process.env.ODEME_SAGLAYICI = ORIGINAL;
  });

  it("sağlayıcı tanımsız: ödeme denemesi DÜRÜST 503 alır (sahte ödendi yok)", async () => {
    delete process.env.ODEME_SAGLAYICI;
    expect(odemeSaglayiciTuru()).toBe("YOK");
    const { svc } = serviceWith();
    await expect(svc.pay("a".repeat(64))).rejects.toThrow(/yapılandırılmadı/i);
  });

  it("SIMULASYON: ödeme kaydı düşer — Payment(ONLINE) + FinancialEntry + ODENDI", async () => {
    process.env.ODEME_SAGLAYICI = "SIMULASYON";
    const { svc, created } = serviceWith();
    const r = await svc.pay("a".repeat(64));
    expect(r.ok).toBe(true);
    expect(r.faturaDurumu).toBe("ODENDI");
    const payment = created.find(([k]) => k === "payment")?.[1] as Record<string, unknown>;
    expect(payment.method).toBe("ONLINE");
    const finans = created.find(([k]) => k === "finans")?.[1] as Record<string, unknown>;
    expect(finans.type).toBe("TAHSILAT");
    expect(String(finans.description)).toContain("portal ödemesi");
    const linkUpd = created.find(([k]) => k === "link-update")?.[1] as Record<string, unknown>;
    expect(linkUpd.status).toBe("ODENDI");
  });

  it("kullanılmış bağlantı: ikinci ödeme 409", async () => {
    process.env.ODEME_SAGLAYICI = "SIMULASYON";
    const { svc } = serviceWith({
      link: {
        id: "link-1",
        tenantId: TENANT,
        invoiceId: "inv-1",
        token: "a".repeat(64),
        amount: new Prisma.Decimal("100000"),
        currency: "TRY",
        status: "ODENDI", // zaten ödenmiş
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await expect(svc.pay("a".repeat(64))).rejects.toThrow(/aktif değil/i);
  });

  it("fatura arada ödenmişse: ödeme KALAN tutar kadar yapılır (fazla ödeme yok)", async () => {
    process.env.ODEME_SAGLAYICI = "SIMULASYON";
    const { svc, created } = serviceWith({ paymentsSum: "60000" }); // 40.000,00 kalan
    const r = await svc.pay("a".repeat(64));
    expect(r.odemeTutari).toBe("40000.00"); // moneyOut → iki ondalık
    const payment = created.find(([k]) => k === "payment")?.[1] as Record<string, unknown>;
    expect(String(payment.amount)).toBe("40000"); // ham Decimal (scale'siz)
  });

  it("geçersiz token biçimi: 404 (tarama yüzeyi yok)", async () => {
    const { svc } = serviceWith();
    await expect(svc.pay("ksk").catch((e) => { throw e; })).rejects.toThrow(NotFoundException);
  });
});

describe("Görünüm (public)", () => {
  it("fatura bilgisi kimlik istemeden döner", async () => {
    const { svc } = serviceWith();
    const r = await svc.view("a".repeat(64));
    expect(r.musteriAdi).toBe("ABC A.Ş.");
    expect(r.faturaNo).toBe("NOM2026000001");
    expect(r.paraBirimi).toBe("TRY");
  });
});
