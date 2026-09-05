/**
 * KVKK SAKLAMA / İMHA + VERİ ÖZNESİ TALEPLERİ — servis testleri.
 *
 *  1. Kesme tarihi = bugün − retentionYears; adaylar KAPANDI + closedAt < kesme + imha edilmemiş.
 *  2. İmha yalnız ADMIN; gerekçe ≥ 10; süresi dolmamış/kapanmamış dosya 403; ikinci imha 400.
 *  3. İmha: belgeler yumuşak silinir, S3 nesnesi denenir (başarısız sayılır), parçalar silinir,
 *     dosya damgalanır; künye kalır.
 *  4. Talep: dueAt = talep + 30 gün; yanıt gerekçe ≥ 10; kapanmış talebe ikinci yanıt yok.
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { KvkkService, kvkkDueAt, retentionCutoff } from "./kvkk.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { StorageService } from "../storage/storage.service";
import type { AuthUser } from "../common/types";

const ADMIN = { userId: "u-admin", tenantId: "t-1", role: "ADMIN" } as AuthUser;
const PARTNER = { userId: "u-p", tenantId: "t-1", role: "PARTNER" } as AuthUser;
const NOW = new Date("2026-09-05T10:00:00Z");

describe("saf yardımcılar", () => {
  it("kesme tarihi N yıl geri; yanıt süresi 30 gün", () => {
    expect(retentionCutoff(10, NOW).toISOString()).toBe("2016-09-05T10:00:00.000Z");
    expect(kvkkDueAt(new Date("2026-09-01T00:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

function harness(opts: { retentionYears?: number; caseRow?: Record<string, unknown> | null; storageFails?: boolean; request?: Record<string, unknown> | null }) {
  const audit: string[] = [];
  const deleted: string[] = [];
  const caseUpdates: Record<string, unknown>[] = [];
  const docUpdates: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const client = {
    tenant: { findUnique: vi.fn(async () => ({ retentionYears: opts.retentionYears ?? 10 })) },
    case: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Aday süzgeci doğrulanır.
        expect(where).toMatchObject({ tenantId: "t-1", status: "KAPANDI", anonymizedAt: null });
        return [{ id: "c-1", title: "Eski dosya", fileNumber: "2010/1", closedAt: new Date("2012-01-01"), client: { id: "cl", name: "Ali" }, _count: { documents: 2 } }];
      }),
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => opts.caseRow ?? null),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => void caseUpdates.push(args.data)),
    },
    kvkkRequest: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => opts.request ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "kr-1", ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "kr-1", ...data })),
    },
    client: { findFirst: vi.fn(async () => ({ id: "cl", name: "Ali" })) },
    document: {
      findMany: vi.fn(async () => [{ id: "d-1", storageKey: "k1" }, { id: "d-2", storageKey: "k2" }]),
      updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => void docUpdates.push(args.data)),
    },
    documentChunk: { deleteMany: vi.fn(async () => ({ count: 7 })) },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const storage = {
    deleteObject: vi.fn(async (key: string) => {
      if (opts.storageFails) throw new Error("s3 kapalı");
      deleted.push(key);
    }),
  } as unknown as StorageService;
  const svc = new KvkkService(
    { client } as unknown as PrismaService,
    { log: vi.fn(async (e: { action: string; detail?: string }) => void audit.push(`${e.action}|${e.detail ?? ""}`)) } as unknown as AuditService,
    storage,
  );
  return { svc, audit, deleted, caseUpdates, docUpdates, created };
}

const OLD_CASE = { id: "c-1", title: "Eski dosya", fileNumber: "2010/1", status: "KAPANDI", closedAt: new Date("2012-01-01"), anonymizedAt: null };

describe("saklama raporu", () => {
  it("politika yılını ve adayları döner", async () => {
    const h = harness({ retentionYears: 12 });
    const r = await h.svc.retentionReport(PARTNER, NOW);
    expect(r.retentionYears).toBe(12);
    expect(r.cutoff.toISOString()).toBe("2014-09-05T10:00:00.000Z");
    expect(r.candidates[0]).toMatchObject({ id: "c-1", documentCount: 2 });
  });
});

describe("imha", () => {
  it("PARTNER uygulayamaz (yalnız ADMIN); kısa gerekçe 400", async () => {
    const h = harness({ caseRow: OLD_CASE });
    await expect(h.svc.anonymizeCase(PARTNER, "c-1", "saklama süresi doldu", NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.svc.anonymizeCase(ADMIN, "c-1", "kısa", NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("süresi dolmamış ya da açık dosyada 403 (m.39 saklama)", async () => {
    const fresh = harness({ caseRow: { ...OLD_CASE, closedAt: new Date("2024-01-01") } });
    await expect(fresh.svc.anonymizeCase(ADMIN, "c-1", "saklama süresi doldu", NOW)).rejects.toBeInstanceOf(ForbiddenException);
    const open = harness({ caseRow: { ...OLD_CASE, status: "DERDEST" } });
    await expect(open.svc.anonymizeCase(ADMIN, "c-1", "saklama süresi doldu", NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("belgeler + parçalar silinir, dosya damgalanır, S3 hatası sayılır ama işlem durmaz; ikinci imha 400", async () => {
    const h = harness({ caseRow: OLD_CASE, storageFails: true });
    const res = await h.svc.anonymizeCase(ADMIN, "c-1", "saklama süresi doldu, talep yok", NOW);
    expect(res).toMatchObject({ documents: 2, chunks: 7, storageFailures: 2 });
    expect(h.docUpdates[0]).toMatchObject({ deletedAt: NOW });
    expect(h.caseUpdates[0]).toMatchObject({ anonymizedAt: NOW });
    expect(h.audit.some((a) => a.startsWith("KVKK_IMHA|") && a.includes("2 S3 nesnesi silinemedi"))).toBe(true);

    const again = harness({ caseRow: { ...OLD_CASE, anonymizedAt: NOW } });
    await expect(again.svc.anonymizeCase(ADMIN, "c-1", "saklama süresi doldu, talep yok", NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("veri öznesi talepleri", () => {
  it("talep 30 günlük yasal süreyle kaydedilir; geçersiz tür reddedilir", async () => {
    const h = harness({});
    const row = await h.svc.createRequest(PARTNER, { clientId: "cl", type: "SILME", subject: "Tüm verilerimi silin", requestedAt: "2026-09-01" });
    expect((row.dueAt as Date).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(h.audit.some((a) => a.startsWith("KVKK_REQUEST_CREATE|"))).toBe(true);
    await expect(h.svc.createRequest(PARTNER, { clientId: "cl", type: "YOK", subject: "x" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("yanıt gerekçe ister; kapanmış talebe ikinci yanıt yok; ret ayrı iz", async () => {
    const h = harness({ request: { id: "kr-1", type: "SILME", status: "ACIK" } });
    await expect(h.svc.respondRequest(PARTNER, "kr-1", { status: "REDDEDILDI", decision: "kısa" })).rejects.toBeInstanceOf(BadRequestException);
    await h.svc.respondRequest(PARTNER, "kr-1", { status: "REDDEDILDI", decision: "Av. K. m.39 saklama yükümlülüğü gereği silinemez; kapanış+10 yıl." });
    expect(h.audit.some((a) => a.startsWith("KVKK_REQUEST_REJECT|"))).toBe(true);
    const closed = harness({ request: { id: "kr-1", type: "SILME", status: "YANITLANDI" } });
    await expect(closed.svc.respondRequest(PARTNER, "kr-1", { status: "YANITLANDI", decision: "yeniden yanıt denemesi" })).rejects.toBeInstanceOf(BadRequestException);
  });
});
