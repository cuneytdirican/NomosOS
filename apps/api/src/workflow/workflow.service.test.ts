/**
 * FAZ 7C — iş akışı şablonları.
 *
 *  1. Sistem şablonları listelenir; büro aynı anahtarla yazarsa sistemi gölgeler.
 *  2. Uygulama: dava türü uyuşmazsa 400; atama verilen → dosya sorumlusu → uygulayan sırası;
 *     son tarih = başlangıç + offsetDays; needsReview adımına kontrolcü; workflowKey yazılır; atlanan adım atlanır.
 *  3. Kontrolcü = sorumlu → 400; başka kiracının dosyası → 404.
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { WorkflowService } from "./workflow.service";
import { SYSTEM_WORKFLOW_TEMPLATES } from "./workflow-templates";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";

const AVUKAT = { userId: "u-av", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;

function harness(opts: { templates?: Array<Record<string, unknown>>; caseType?: string; responsible?: string | null } = {}) {
  const tasks: Record<string, unknown>[] = [];
  const client = {
    workflowTemplate: {
      findMany: vi.fn(async () => opts.templates ?? []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "wt-1", ...data })),
    },
    case: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => (where.id === "case-A" && where.tenantId === "buro-A" ? { id: "case-A", type: opts.caseType ?? "DAVA", responsibleUserId: opts.responsible === undefined ? "u-resp" : opts.responsible, title: "ABC v XYZ" } : null)),
      update: vi.fn(async () => ({})),
    },
    user: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (["u-av", "u-resp", "u-rev", "u-x"].includes(where.id) ? { id: where.id } : null)) },
    task: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `t-${tasks.length + 1}`, ...data };
        tasks.push(t);
        return t;
      }),
    },
    taskStatusLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  const svc = new WorkflowService({ client } as unknown as PrismaService, { log: vi.fn(async () => undefined) } as unknown as AuditService);
  return { svc, tasks, client };
}

describe("Faz 7C: şablon listesi", () => {
  it("sistem şablonları + tür süzgeci; büro şablonu aynı anahtarı gölgeler", async () => {
    const h = harness({ templates: [{ id: "wt-9", key: "SYS_DAVA_ACILIS", name: "Bizim dava açılışı", caseType: "DAVA", description: null, itemsJson: JSON.stringify([{ title: "Tek adım", offsetDays: 1 }]), isActive: true }] });
    const all = await h.svc.list(AVUKAT);
    expect(all.filter((t) => t.key === "SYS_DAVA_ACILIS")).toHaveLength(1);
    expect(all.find((t) => t.key === "SYS_DAVA_ACILIS")?.isSystem).toBe(false);
    expect(all.find((t) => t.key === "SYS_DAVA_ACILIS")?.items[0]).toMatchObject({ title: "Tek adım", priority: "NORMAL", offsetDays: 1 });
    const icra = await h.svc.list(AVUKAT, "ICRA");
    expect(icra.map((t) => t.key)).toEqual(expect.arrayContaining(["SYS_ICRA_TAKIP", "SYS_DOSYA_KAPANIS"]));
    expect(icra.map((t) => t.key)).not.toContain("SYS_CEZA_SORUSTURMA");
    expect(SYSTEM_WORKFLOW_TEMPLATES.every((t) => t.items.length >= 3)).toBe(true);
  });
});

describe("Faz 7C: şablon uygulama", () => {
  it("görev zinciri: son tarih = başlangıç + offset; kontrolcü yalnız needsReview adımlarında; workflowKey", async () => {
    const h = harness();
    const res = await h.svc.apply(AVUKAT, "SYS_DAVA_ACILIS", { caseId: "case-A", reviewerId: "u-rev", startDate: new Date("2026-09-07T10:00:00Z") });
    const tpl = SYSTEM_WORKFLOW_TEMPLATES.find((t) => t.key === "SYS_DAVA_ACILIS")!;
    expect(res.count).toBe(tpl.items.length);
    expect(h.tasks[0]).toMatchObject({ assigneeId: "u-resp", workflowKey: "SYS_DAVA_ACILIS", caseId: "case-A" });
    expect((h.tasks[0].dueDate as Date).toISOString()).toBe("2026-09-07T00:00:00.000Z");
    const dilekce = h.tasks.find((t) => String(t.title).startsWith("Dava dilekçesi"))!;
    expect(dilekce.reviewerId).toBe("u-rev");
    expect((dilekce.dueDate as Date).toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(h.tasks[0].reviewerId).toBeNull();
    expect(String(h.tasks[0].description)).toContain("Önerilen rol: SEKRETER");
  });

  it("atama sırası: verilen → sorumlu → uygulayan; atlanan adımlar", async () => {
    const h = harness({ responsible: null });
    const res = await h.svc.apply(AVUKAT, "SYS_DOSYA_KAPANIS", { caseId: "case-A", skip: [0, 3] });
    expect(res.count).toBe(2);
    expect(h.tasks.every((t) => t.assigneeId === "u-av")).toBe(true);
    const h2 = harness();
    await h2.svc.apply(AVUKAT, "SYS_DOSYA_KAPANIS", { caseId: "case-A", assigneeId: "u-x" });
    expect(h2.tasks[0].assigneeId).toBe("u-x");
  });

  it("tür uyuşmazlığı 400; kontrolcü = sorumlu 400; başka kiracı 404; bilinmeyen şablon 404", async () => {
    await expect(harness({ caseType: "ICRA" }).svc.apply(AVUKAT, "SYS_DAVA_ACILIS", { caseId: "case-A" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(harness().svc.apply(AVUKAT, "SYS_DAVA_ACILIS", { caseId: "case-A", assigneeId: "u-rev", reviewerId: "u-rev" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(harness().svc.apply({ ...AVUKAT, tenantId: "buro-B" }, "SYS_DAVA_ACILIS", { caseId: "case-A" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(harness().svc.apply(AVUKAT, "YOK", { caseId: "case-A" })).rejects.toBeInstanceOf(NotFoundException);
  });
});
