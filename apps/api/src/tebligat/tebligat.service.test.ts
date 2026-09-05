/**
 * FAZ 6 — Tebligat varlığı ve süre tetikleyici.
 *
 * Korunan taahhütler:
 *  1. Tebliğ tarihi + kural anahtarı birlikte varsa süre kural motorundan AÇILIR ve
 *     tebligat kaydı deadlineId ile bağlanır; ikisi de yoksa süre açılmaz.
 *  2. Tebliğ yöntemi kanaldan türetilir (UETS/KEP/EPOSTA → ETEBLIGAT, PTT → POSTA, ELDEN → ELDEN)
 *     ve süre motorunun kabul ettiği değer kümesindedir (7201 s. Kanun e-tebligat hesabı).
 *  3. Aynı tebligat için süre İKİ KEZ açılmaz (deadlineId doluysa atlanır).
 *  4. Başka kiracının dosyasına tebligat yazılamaz (404).
 *  5. Süre motoru hata verirse tebligat kaydı DURUR ama hata görünür (sessiz yutma yok).
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TebligatService, serviceMethodFor } from "./tebligat.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { DeadlinesService } from "../deadlines/deadlines.service";
import type { TebligatSaglayiciRegistry } from "./tebligat-saglayici";
import type { AuthUser } from "../common/types";

const AVUKAT = { userId: "u-1", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;

function harness(opts: { deadlineFails?: boolean } = {}) {
  let seq = 0;
  const rows = new Map<string, Record<string, unknown>>();
  const fromRule: Record<string, unknown>[] = [];
  const client = {
    case: { findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => (where.id === "case-A" && where.tenantId === "buro-A" ? { id: "case-A" } : null)) },
    tebligat: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `tb-${seq}`, deadlineId: null, createdAt: new Date(), ...data };
        rows.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...(rows.get(where.id) ?? {}), ...data };
        rows.set(where.id, row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const r = rows.get(where.id);
        return r && r.tenantId === where.tenantId ? r : null;
      }),
      findMany: vi.fn(async () => [...rows.values()]),
      delete: vi.fn(async () => ({})),
    },
  };
  const deadlines = {
    createFromRule: vi.fn(async (_u: AuthUser, input: Record<string, unknown>) => {
      fromRule.push(input);
      if (opts.deadlineFails) throw new Error("Kural bulunamadı: X");
      return { deadline: { id: `dl-${fromRule.length}` }, steps: [], warnings: [] };
    }),
  };
  const registry = { describe: () => ({ providerKey: "NOOP", configured: false, note: "" }) };
  const svc = new TebligatService(
    { client } as unknown as PrismaService,
    { log: vi.fn(async () => undefined) } as unknown as AuditService,
    deadlines as unknown as DeadlinesService,
    registry as unknown as TebligatSaglayiciRegistry,
  );
  return { svc, client, fromRule, rows };
}

describe("Faz 6: serviceMethodFor", () => {
  it("kanal → süre motoru tebliğ yöntemi (kabul edilen küme)", () => {
    expect(serviceMethodFor("UETS")).toBe("ETEBLIGAT");
    expect(serviceMethodFor("KEP")).toBe("ETEBLIGAT");
    expect(serviceMethodFor("EPOSTA")).toBe("ETEBLIGAT");
    expect(serviceMethodFor("PTT")).toBe("POSTA");
    expect(serviceMethodFor("ELDEN")).toBe("ELDEN");
    expect(serviceMethodFor("DIGER")).toBe("ELDEN");
  });
});

describe("Faz 6: TebligatService", () => {
  it("tebliğ tarihi + kural → süre açılır ve kayda bağlanır", async () => {
    const h = harness();
    const res = await h.svc.create(AVUKAT, "case-A", {
      channel: "UETS",
      direction: "GELEN",
      subject: "Gerekçeli karar tebliği",
      servedAt: new Date("2026-03-10T00:00:00Z"),
      deadlineRuleKey: "HMK_ISTINAF",
    } as Parameters<TebligatService["create"]>[2]);
    expect(res.deadlineId).toBe("dl-1");
    expect(h.fromRule[0]).toMatchObject({ caseId: "case-A", ruleKey: "HMK_ISTINAF", serviceMethod: "ETEBLIGAT" });
    expect((h.fromRule[0].triggerDate as Date).toISOString()).toBe("2026-03-10T00:00:00.000Z");
  });

  it("tebliğ tarihi yoksa süre açılmaz; sonradan tarih girilince açılır; ikinci kez açılmaz", async () => {
    const h = harness();
    const created = await h.svc.create(AVUKAT, "case-A", { channel: "PTT", direction: "GELEN", subject: "Ödeme emri", deadlineRuleKey: "IIK_ODEME_EMRI_ITIRAZ" } as Parameters<TebligatService["create"]>[2]);
    expect(created.deadlineId).toBeNull();
    expect(h.fromRule).toHaveLength(0);

    const updated = await h.svc.update(AVUKAT, created.id, { servedAt: new Date("2026-04-01T00:00:00Z") } as Parameters<TebligatService["update"]>[2]);
    expect(updated.deadlineId).toBe("dl-1");
    expect(h.fromRule[0]).toMatchObject({ serviceMethod: "POSTA", ruleKey: "IIK_ODEME_EMRI_ITIRAZ" });

    const again = await h.svc.update(AVUKAT, created.id, { note: "not" } as Parameters<TebligatService["update"]>[2]);
    expect(again.deadlineId).toBe("dl-1");
    expect(h.fromRule).toHaveLength(1);
  });

  it("başka kiracının dosyası → 404", async () => {
    const h = harness();
    await expect(h.svc.create({ ...AVUKAT, tenantId: "buro-B" }, "case-A", { channel: "ELDEN", direction: "GIDEN", subject: "İhtarname" } as Parameters<TebligatService["create"]>[2])).rejects.toBeInstanceOf(NotFoundException);
  });

  it("süre motoru hata verirse tebligat kalır, hata görünür (sessiz yutma yok)", async () => {
    const h = harness({ deadlineFails: true });
    await expect(
      h.svc.create(AVUKAT, "case-A", { channel: "UETS", direction: "GELEN", subject: "Karar", servedAt: new Date(), deadlineRuleKey: "YOK_BOYLE_KURAL" } as Parameters<TebligatService["create"]>[2]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.rows.size).toBe(1);
  });
});
