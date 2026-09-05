/**
 * FAZ 6 — kronometre (TimeTimerService).
 *
 * Korunan taahhütler:
 *  1. Kullanıcı başına TEK kronometre (ikinci start → 400).
 *  2. Başka kiracının kronometresi görünmez/durdurulamaz (tenantId kapısı).
 *  3. Durdurma: dakikaya YUKARI yuvarlanmış (min 1) TASLAK zaman kaydı + kronometre silinir + denetim.
 *  4. Dosya seçildiyse müvekkil dosyadan türetilir; başka kiracının dosyası → 404.
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TimeTimerService, elapsedMinutes } from "./time-timer.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";

const AVUKAT = { userId: "u-1", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;
const YABANCI = { userId: "u-1", tenantId: "buro-B", role: "AVUKAT" } as AuthUser;

function harness(timer: Record<string, unknown> | null) {
  const created: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const client = {
    timeTimer: {
      findUnique: vi.fn(async () => timer),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        timer = { id: "t-1", startedAt: new Date(), ...data };
        return timer;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
        timer = null;
        return {};
      }),
    },
    case: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => (where.id === "case-A" && where.tenantId === "buro-A" ? { id: "case-A", clientId: "cl-A" } : null)),
    },
    timeEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "te-1", ...data };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  const audit = { log: vi.fn(async (e: Record<string, unknown>) => audits.push(e)) };
  const svc = new TimeTimerService({ client } as unknown as PrismaService, audit as unknown as AuditService);
  return { svc, client, created, deleted, audits };
}

describe("Faz 6: elapsedMinutes", () => {
  it("dakikaya yukarı yuvarlar; en az 1", () => {
    const t0 = new Date("2026-03-01T10:00:00Z");
    expect(elapsedMinutes(t0, new Date("2026-03-01T10:00:05Z"))).toBe(1);
    expect(elapsedMinutes(t0, new Date("2026-03-01T10:01:01Z"))).toBe(2);
    expect(elapsedMinutes(t0, new Date("2026-03-01T11:30:00Z"))).toBe(90);
  });
});

describe("Faz 6: TimeTimerService", () => {
  it("çalışan kronometre yokken current → calisiyor:false", async () => {
    const h = harness(null);
    expect(await h.svc.current(AVUKAT)).toEqual({ calisiyor: false });
  });

  it("start: dosyadan müvekkil türetir; ikinci start 400", async () => {
    const h = harness(null);
    const res = await h.svc.start(AVUKAT, { caseId: "case-A", description: "Dilekçe taslağı" });
    expect(res.calisiyor).toBe(true);
    expect(h.client.timeTimer.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ clientId: "cl-A", tenantId: "buro-A", userId: "u-1" }) }));
    await expect(h.svc.start(AVUKAT, { description: "İkinci" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("start: başka kiracının dosyası → 404 (kimlik sızdırmaz)", async () => {
    const h = harness(null);
    await expect(h.svc.start(YABANCI, { caseId: "case-A", description: "Sızma denemesi" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("stop: TASLAK zaman kaydı + kronometre silinir + denetim izi", async () => {
    const startedAt = new Date(Date.now() - 25 * 60_000 - 10_000); // 25 dk 10 sn → 26 dk
    const h = harness({ id: "t-9", tenantId: "buro-A", userId: "u-1", caseId: "case-A", clientId: "cl-A", description: "Duruşma hazırlığı", startedAt });
    const res = await h.svc.stop(AVUKAT, { billable: true });
    expect(res.minutes).toBe(26);
    expect(res.status).toBe("TASLAK");
    expect(h.created[0]).toMatchObject({ status: "TASLAK", minutes: 26, caseId: "case-A", clientId: "cl-A", tenantId: "buro-A" });
    expect(h.deleted).toEqual(["t-9"]);
    expect(h.audits[0]).toMatchObject({ action: "TIME_ENTRY_CREATE", entity: "TimeEntry" });
  });

  it("stop/current: başka kiracı aynı userId ile göremez", async () => {
    const h = harness({ id: "t-9", tenantId: "buro-A", userId: "u-1", caseId: null, clientId: null, description: "x", startedAt: new Date() });
    expect(await h.svc.current(YABANCI)).toEqual({ calisiyor: false });
    await expect(h.svc.stop(YABANCI, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(h.deleted).toEqual([]);
  });
});
