/**
 * FAZ 7G — kapanış kontrol listesi.
 *  1. Sistem kalemleri veriden: açık süre/görev/fatura/zaman/müvekkil isteği/avans; vekâlet bilgi kalemi engel değildir.
 *  2. readyToClose yalnız sistem + manuel kalemlerin tamamı tamamsa.
 *  3. Manuel işaretleme kaydedilir (kim/ne zaman), not korunur; arşiv kutusu yazılır; başka kiracı 404.
 */

import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { CaseClosingService, MANUAL_CLOSING_ITEMS } from "./case-closing.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";

const AVUKAT = { userId: "u-1", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;

function harness(counts: Partial<{ deadlines: number; tasks: number; invoices: number; minutes: number; todos: number; expenses: number; poa: number }> = {}) {
  const c = { id: "case-A", tenantId: "buro-A", title: "X", status: "KARAR", closedAt: null, closingChecklistJson: null as string | null, archiveBoxNo: null as string | null, clientId: "cl-1", isConfidential: false };
  const client = {
    case: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => (where.id === c.id && where.tenantId === c.tenantId ? c : null)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(c, data);
        return c;
      }),
    },
    deadline: { count: vi.fn(async () => counts.deadlines ?? 0) },
    task: { count: vi.fn(async () => counts.tasks ?? 0) },
    invoice: { count: vi.fn(async () => counts.invoices ?? 0) },
    financialEntry: { findMany: vi.fn(async () => [{ invoiceId: "inv-1" }]) },
    timeEntry: { aggregate: vi.fn(async () => ({ _sum: { minutes: counts.minutes ?? 0 } })) },
    portalTodo: { count: vi.fn(async () => counts.todos ?? 0) },
    caseExpense: { count: vi.fn(async () => counts.expenses ?? 0) },
    powerOfAttorney: { count: vi.fn(async () => counts.poa ?? 0) },
  };
  return { svc: new CaseClosingService({ client } as unknown as PrismaService, { log: vi.fn(async () => undefined) } as unknown as AuditService), c };
}

describe("Faz 7G: kapanış kontrol listesi", () => {
  it("sistem engelleri sayılır; readyToClose false; vekâlet kalemi engel değil", async () => {
    const h = harness({ deadlines: 1, tasks: 2, minutes: 90, poa: 1 });
    const r = await h.svc.checklist(AVUKAT, "case-A");
    expect(r.auto.find((a) => a.key === "ACIK_SURE")).toMatchObject({ ok: false, count: 1 });
    expect(r.auto.find((a) => a.key === "FATURALANMAMIS_ZAMAN")).toMatchObject({ ok: false, count: 90 });
    expect(r.auto.find((a) => a.key === "VEKALET")).toMatchObject({ ok: true, count: 1 });
    expect(r.readyToClose).toBe(false);
    expect(r.summary).toContain("3 sistem engeli");
  });

  it("manuel kalemler işaretlenince readyToClose true; not ve arşiv kutusu saklanır", async () => {
    const h = harness();
    let r = await h.svc.checklist(AVUKAT, "case-A");
    expect(r.readyToClose).toBe(false);
    expect(r.manual).toHaveLength(MANUAL_CLOSING_ITEMS.length);
    r = await h.svc.save(AVUKAT, "case-A", { items: MANUAL_CLOSING_ITEMS.map((m) => ({ key: m.key, done: true, note: m.key === "ARSIV" ? "Kutu 12" : null })), archiveBoxNo: "ARS-2026-12" });
    expect(r.readyToClose).toBe(true);
    expect(r.archiveBoxNo).toBe("ARS-2026-12");
    expect(r.manual.find((m) => m.key === "ARSIV")).toMatchObject({ done: true, note: "Kutu 12", by: "u-1" });
    // not verilmeden yeniden kaydet → not korunur
    r = await h.svc.save(AVUKAT, "case-A", { items: [{ key: "ARSIV", done: true }] });
    expect(r.manual.find((m) => m.key === "ARSIV")?.note).toBe("Kutu 12");
  });

  it("başka kiracı 404", async () => {
    const h = harness();
    await expect(h.svc.checklist({ ...AVUKAT, tenantId: "buro-B" }, "case-A")).rejects.toBeInstanceOf(NotFoundException);
  });
});
