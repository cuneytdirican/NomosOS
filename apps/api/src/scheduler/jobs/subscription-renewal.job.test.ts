/**
 * Abonelik dönem denetimi (Faz 3): dönem sonuna 7 gün kala fatura + bildirim; PAST_DUE
 * geçişi; dunning 1/3/7. gün; deneme bitişi uyarısı; idempotentlik.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PlatformAuditService } from "../../platform/platform-audit.service";
import type { SubscriptionInvoiceService } from "../../platform-billing/subscription-invoice.service";
import type { NotificationOutboxService, OutboxEntry } from "../notification-outbox.service";
import type { TenantRecipientsService } from "../tenant-recipients";
import { SubscriptionRenewalJob } from "./subscription-renewal.job";

const NOW = new Date("2026-09-05T03:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function build(subs: Array<Record<string, unknown>>) {
  const entries: OutboxEntry[] = [];
  const prisma = {
    client: {
      subscription: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const st = where.status as { in?: string[] } | string;
          const allowed = typeof st === "string" ? [st] : (st?.in ?? []);
          return subs.filter((s) => allowed.includes(s.status as string)).filter((s) => {
            const cpe = where.currentPeriodEnd as { lte?: Date } | undefined;
            if (cpe?.lte && (!s.currentPeriodEnd || (s.currentPeriodEnd as Date) > cpe.lte)) return false;
            const te = where.trialEndsAt as { gt?: Date; lte?: Date } | undefined;
            if (te?.lte && (!s.trialEndsAt || (s.trialEndsAt as Date) > te.lte || (s.trialEndsAt as Date) <= (te.gt as Date))) return false;
            return true;
          });
        }),
        updateMany: vi.fn(async ({ where }: { where: { id: string; status: string } }) => {
          const s = subs.find((x) => x.id === where.id && x.status === where.status);
          if (!s) return { count: 0 };
          s.status = "PAST_DUE";
          return { count: 1 };
        }),
        count: vi.fn(async () => 0),
      },
      invoiceRecord: { findFirst: vi.fn(async () => ({ id: "inv-open", number: "NOM-2026-000001", total: { toFixed: () => "7200.00" } })) },
    },
  } as unknown as PrismaService;
  const audit = { log: vi.fn(async () => undefined) } as unknown as PlatformAuditService;
  const issueForPeriod = vi.fn(async ({ subscription, periodStart }: { subscription: { tenantId: string }; periodStart: Date }) => ({
    created: true,
    invoice: { id: `inv-${subscription.tenantId}`, number: "NOM-2026-000005", total: { toFixed: () => "7200.00" }, description: "Büro planı", dueDate: new Date(periodStart.getTime() + 7 * 86_400_000) },
  }));
  const invoices = { issueForPeriod } as unknown as SubscriptionInvoiceService;
  const outbox = { enqueueMany: vi.fn(async (e: OutboxEntry[]) => { entries.push(...e); return { created: e.length, skipped: 0, failed: 0, errors: [] }; }) } as unknown as NotificationOutboxService;
  const recipients = { load: vi.fn(async (tenantId: string) => ({ tenantId, activeUserIds: new Set(["a1"]), fallbackUserIds: ["a1", "a2"] })) } as unknown as TenantRecipientsService;
  return { job: new SubscriptionRenewalJob(prisma, audit, invoices, outbox, recipients), entries, issueForPeriod, subs };
}

describe("SubscriptionRenewalJob (Faz 3)", () => {
  it("dönem sonuna ≤7 gün: fatura kesilir + 2 yöneticiye FATURA_KESILDI; dönem sonu geçen ACTIVE → PAST_DUE", async () => {
    const b = build([
      { id: "s1", tenantId: "t1", status: "ACTIVE", planKey: "BURO", currentPeriodEnd: day(5), trialEndsAt: null },
      { id: "s2", tenantId: "t2", status: "ACTIVE", planKey: "BURO", currentPeriodEnd: day(-0.5), trialEndsAt: null },
      { id: "s3", tenantId: "t3", status: "ACTIVE", planKey: "BURO", currentPeriodEnd: day(20), trialEndsAt: null },
    ]);
    const r = await b.job.run({ trigger: "CRON", now: NOW } as never);
    expect(b.issueForPeriod).toHaveBeenCalledTimes(2); // s1 (5 gün) + s2 (geçmiş)
    expect(r.detail).toMatchObject({ faturaKesilen: 2, faturaBildirim: 4 });
    expect(b.entries.filter((e) => e.kind === "FATURA_KESILDI")).toHaveLength(4);
    expect(b.subs.find((s) => s.id === "s2")?.status).toBe("PAST_DUE");
    expect(b.subs.find((s) => s.id === "s1")?.status).toBe("ACTIVE");
  });

  it("zaten var olan fatura yeniden bildirilmez (created:false)", async () => {
    const b = build([{ id: "s1", tenantId: "t1", status: "ACTIVE", planKey: "BURO", currentPeriodEnd: day(3), trialEndsAt: null }]);
    (b.issueForPeriod as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ created: false, invoice: {} });
    const r = await b.job.run({ trigger: "CRON", now: NOW } as never);
    expect(r.detail).toMatchObject({ faturaKesilen: 0, faturaBildirim: 0 });
  });

  it("dunning: PAST_DUE 1/3/7. günde ODEME_GECIKTI; 2. günde yok; dedupe anahtarı gün taşır", async () => {
    const b = build([
      { id: "p1", tenantId: "t1", status: "PAST_DUE", planKey: "BURO", currentPeriodEnd: day(-1), trialEndsAt: null },
      { id: "p2", tenantId: "t2", status: "PAST_DUE", planKey: "BURO", currentPeriodEnd: day(-2), trialEndsAt: null },
      { id: "p3", tenantId: "t3", status: "PAST_DUE", planKey: "BURO", currentPeriodEnd: day(-7), trialEndsAt: null },
    ]);
    const r = await b.job.run({ trigger: "CRON", now: NOW } as never);
    const dun = b.entries.filter((e) => e.kind === "ODEME_GECIKTI");
    expect(dun).toHaveLength(4); // p1 ×2 yönetici, p3 ×2
    expect(dun[0].dedupeKey).toMatch(/^ODEME_GECIKTI:p1:.*:g1:a1$/);
    expect(dun[0].title).toContain("1 gündür");
    expect(dun[2].body).toContain("7 gün içinde"); // 14 − 7
    expect(r.detail).toMatchObject({ dunningBildirim: 4 });
  });

  it("deneme bitişine ≤3 gün: DENEME_BITIYOR", async () => {
    const b = build([
      { id: "tr1", tenantId: "t1", status: "TRIAL", planKey: "SOLO", currentPeriodEnd: null, trialEndsAt: day(2) },
      { id: "tr2", tenantId: "t2", status: "TRIAL", planKey: "SOLO", currentPeriodEnd: null, trialEndsAt: day(10) },
    ]);
    const r = await b.job.run({ trigger: "CRON", now: NOW } as never);
    expect(b.entries.filter((e) => e.kind === "DENEME_BITIYOR")).toHaveLength(2);
    expect(r.detail).toMatchObject({ denemeBildirim: 2 });
  });
});
