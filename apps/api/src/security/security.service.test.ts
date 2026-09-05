/**
 * BÜRO GÜVENLİK & DENETİM İZİ — servis testleri (Enterprise++).
 *
 *  1. CSV hücreleri formül enjeksiyonuna karşı nötrlenir (=, +, -, @).
 *  2. Denetim izi sorguları HER ZAMAN tenantId taşır; süzgeçler AND'lenir.
 *  3. Politika değişikliği yalnız ADMIN; oturum ömrü 1-24 sa; denetim izine yazılır.
 *  4. Dışa aktarım denetim izine AUDIT_EXPORT olarak düşer, 5000+ satırda kesildiğini söyler.
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { AUDIT_EXPORT_MAX_ROWS, SecurityService, csvCell } from "./security.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";

const ADMIN = { userId: "u-admin", tenantId: "buro-A", role: "ADMIN" } as AuthUser;
const PARTNER = { userId: "u-p", tenantId: "buro-A", role: "PARTNER" } as AuthUser;
const AVUKAT = { userId: "u-av", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;

describe("csvCell — formül enjeksiyonu", () => {
  it("=, +, -, @ ile başlayan hücre tek tırnakla nötrlenir; ; ve tırnak kaçırılır", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM")).toBe("'@SUM");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell(null)).toBe("");
    expect(csvCell("düz metin")).toBe("düz metin");
  });
});

function harness(rows: Array<Record<string, unknown>> = []) {
  const captured: { where?: Record<string, unknown>; take?: number }[] = [];
  const audit: string[] = [];
  const tenantUpdates: Record<string, unknown>[] = [];
  const client = {
    auditLog: {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take?: number }) => {
        captured.push({ where: args.where, take: args.take });
        return rows;
      }),
      count: vi.fn(async () => rows.length),
      groupBy: vi.fn(async () => [{ action: "LOGIN_SUCCESS", _count: { _all: 3 } }]),
    },
    user: {
      findMany: vi.fn(async () => [{ id: "u-1", fullName: "Av. Ayşe" }]),
      count: vi.fn(async () => 4),
    },
    tenant: {
      findUnique: vi.fn(async () => ({ require2fa: false, sessionMaxHours: null })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        tenantUpdates.push(data);
        return { require2fa: data.require2fa ?? false, sessionMaxHours: data.sessionMaxHours ?? null };
      }),
    },
  };
  const svc = new SecurityService(
    { client } as unknown as PrismaService,
    { log: vi.fn(async (e: { action: string }) => void audit.push(e.action)) } as unknown as AuditService,
  );
  return { svc, captured, audit, tenantUpdates };
}

const ROW = {
  id: "a-1",
  tenantId: "buro-A",
  userId: "u-1",
  action: "CLIENT_CREATE",
  entity: "Client",
  entityId: "c-1",
  detail: "=cmd|' /C calc'!A0",
  createdAt: new Date("2026-09-05T10:00:00Z"),
};

describe("denetim izi — kiracı süzgeci ve süzgeçler", () => {
  it("sorgu her zaman tenantId taşır; işlem/kullanıcı/tarih/metin süzgeçleri AND'lenir", async () => {
    const h = harness([ROW]);
    const res = await h.svc.listAudit(PARTNER, { action: "client_create", userId: "u-1", from: "2026-09-01", to: "2026-09-30", q: "calc" });
    expect(res.items[0].userName).toBe("Av. Ayşe");
    const where = h.captured[0].where!;
    expect(where.tenantId).toBe("buro-A");
    expect(where.action).toBe("CLIENT_CREATE");
    expect(where.userId).toBe("u-1");
    expect(where.createdAt).toBeDefined();
    expect(Array.isArray(where.OR)).toBe(true);
  });

  it("AVUKAT denetim izini göremez (403)", async () => {
    const h = harness();
    await expect(h.svc.listAudit(AVUKAT, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("CSV dışa aktarım: formül nötrlenir, BOM ile başlar, AUDIT_EXPORT iz bırakır", async () => {
    const h = harness([ROW]);
    const out = await h.svc.exportAuditCsv(ADMIN, {});
    expect(out.csv.charCodeAt(0)).toBe(0xfeff);
    expect(out.csv).toContain("'=cmd");
    expect(out.csv).toContain("Av. Ayşe");
    expect(out.rowCount).toBe(1);
    expect(out.truncated).toBe(false);
    expect(h.captured[0].take).toBe(AUDIT_EXPORT_MAX_ROWS + 1);
    expect(h.audit).toContain("AUDIT_EXPORT");
  });
});

describe("güvenlik politikası", () => {
  it("yalnız ADMIN değiştirir; PARTNER 403", async () => {
    const h = harness();
    await expect(h.svc.updatePolicy(PARTNER, { require2fa: true })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("oturum ömrü aralık dışı reddedilir; geçerli değişiklik denetim izine yazılır", async () => {
    const h = harness();
    await expect(h.svc.updatePolicy(ADMIN, { sessionMaxHours: 48 })).rejects.toBeInstanceOf(BadRequestException);
    const res = await h.svc.updatePolicy(ADMIN, { require2fa: true, sessionMaxHours: 8 });
    expect(res).toEqual({ require2fa: true, sessionMaxHours: 8 });
    expect(h.tenantUpdates[0]).toEqual({ require2fa: true, sessionMaxHours: 8 });
    expect(h.audit).toContain("SECURITY_POLICY_UPDATE");
  });

  it("getPolicy 2FA yaygınlığını ve düzenleme yetkisini döner", async () => {
    const h = harness();
    const p = await h.svc.getPolicy(PARTNER);
    expect(p.users.total).toBe(4);
    expect(p.canEdit).toBe(false);
    expect((await h.svc.getPolicy(ADMIN)).canEdit).toBe(true);
  });
});
