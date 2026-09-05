/**
 * Cihaz bazlı oturum listesi: kayıt (UA → etiket), listeleme (açık tanımı:
 * iptal yok + süre dolmamış + sessionsValidFrom sonrası), tek oturum kapatma
 * (bu cihaz dâhil), diğerlerini kapatma, yönetici görünümü/kapatma
 * (kiracı sınırı), eski kayıt temizliği.
 */

import { describe, expect, it, vi } from "vitest";
import { UserSessionsService } from "./user-sessions.service";

const me = { userId: "u1", tenantId: "t1", role: "AVUKAT" as const, sessionId: "s-cur" };
const admin = { userId: "u-adm", tenantId: "t1", role: "ADMIN" as const, sessionId: "s-adm" };

function build(validFrom: Date | null = null) {
  const users: any[] = [
    { id: "u1", tenantId: "t1", email: "ali@buro.com", sessionsValidFrom: validFrom },
    { id: "u2", tenantId: "t1", email: "veli@buro.com", sessionsValidFrom: null },
    { id: "u9", tenantId: "t2", email: "yabanci@baska.com", sessionsValidFrom: null },
  ];
  const rows: any[] = [];
  const now = Date.now();
  const future = new Date(now + 3_600_000);
  const prisma = {
    client: {
      user: {
        findUnique: vi.fn(async ({ where }: any) => users.find((u) => u.id === where.id) ?? null),
        findFirst: vi.fn(async ({ where }: any) => users.find((u) => u.id === where.id && u.tenantId === where.tenantId) ?? null),
      },
      userSession: {
        create: vi.fn(async ({ data }: any) => {
          const r = { revokedAt: null, revokedBy: null, createdAt: new Date(), lastSeenAt: new Date(), ...data };
          rows.push(r);
          return r;
        }),
        findMany: vi.fn(async ({ where }: any) =>
          rows.filter(
            (r) =>
              r.userId === where.userId &&
              r.revokedAt === null &&
              r.expiresAt > where.expiresAt.gt &&
              (!where.createdAt || r.createdAt >= where.createdAt.gte),
          ),
        ),
        findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.userId === where.userId && r.revokedAt === null) ?? null),
        update: vi.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const hit = rows.filter((r) => r.userId === where.userId && r.revokedAt === null && r.expiresAt > where.expiresAt.gt && (!where.id || r.id !== where.id.not));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
        deleteMany: vi.fn(async ({ where }: any) => {
          const [a, b] = where.OR;
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i];
            if (r.expiresAt < a.expiresAt.lt || (r.revokedAt && r.revokedAt < b.revokedAt.lt)) rows.splice(i, 1);
          }
          return { count: before - rows.length };
        }),
      },
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  const svc = new UserSessionsService(prisma as any, audit as any);
  return { svc, prisma, audit, rows, future };
}

describe("UserSessionsService", () => {
  it("record: UA etiketlenir, ip/ua kırpılır", async () => {
    const { svc, rows, future } = build();
    await svc.record({ id: "s1", tenantId: "t1", userId: "u1", jti: "j1", via: "parola", expiresAt: future, meta: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36", ip: "10.0.0.1" } });
    expect(rows[0]).toMatchObject({ jti: "j1", deviceLabel: "Chrome · Windows", ip: "10.0.0.1", via: "parola" });
  });

  it("listOwn: açık olanlar, şu anki işaretli; sessionsValidFrom öncesi açılanlar görünmez; jti sızmaz", async () => {
    const validFrom = new Date(Date.now() - 60_000);
    const { svc, rows, future } = build(validFrom);
    await svc.record({ id: "s-old", tenantId: "t1", userId: "u1", jti: "j-old", via: "parola", expiresAt: future });
    rows[0].createdAt = new Date(validFrom.getTime() - 5_000);
    await svc.record({ id: "s-cur", tenantId: "t1", userId: "u1", jti: "j-cur", via: "parola+2fa", expiresAt: future });
    await svc.record({ id: "s-other", tenantId: "t1", userId: "u1", jti: "j-oth", via: "sso", expiresAt: future });
    await svc.record({ id: "s-exp", tenantId: "t1", userId: "u1", jti: "j-exp", via: "parola", expiresAt: new Date(Date.now() - 1) });
    const { items } = await svc.listOwn(me);
    expect(items.map((i) => i.id).sort()).toEqual(["s-cur", "s-other"]);
    expect(items.find((i) => i.id === "s-cur")!.current).toBe(true);
    expect(items.find((i) => i.id === "s-other")!.current).toBe(false);
    expect(JSON.stringify(items)).not.toContain("jti");
  });

  it("revokeOwn: başkasının oturumu 404; kendi oturumu kapanır (bu cihaz → current:true); iki kez → 404", async () => {
    const { svc, rows, future, audit } = build();
    await svc.record({ id: "s-cur", tenantId: "t1", userId: "u1", jti: "a", via: "parola", expiresAt: future });
    await svc.record({ id: "s-u2", tenantId: "t1", userId: "u2", jti: "b", via: "parola", expiresAt: future });
    await expect(svc.revokeOwn(me, "s-u2")).rejects.toThrow(/bulunamadı/);
    const r = await svc.revokeOwn(me, "s-cur");
    expect(r.current).toBe(true);
    expect(rows[0].revokedAt).toBeInstanceOf(Date);
    expect(rows[0].revokedBy).toBe("u1");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "SESSION_REVOKE", detail: expect.stringContaining("bu cihaz") }));
    await expect(svc.revokeOwn(me, "s-cur")).rejects.toThrow(/bulunamadı/);
  });

  it("revokeOthers: bu cihaz kalır, diğerleri kapanır", async () => {
    const { svc, rows, future } = build();
    await svc.record({ id: "s-cur", tenantId: "t1", userId: "u1", jti: "a", via: "parola", expiresAt: future });
    await svc.record({ id: "s-2", tenantId: "t1", userId: "u1", jti: "b", via: "parola", expiresAt: future });
    await svc.record({ id: "s-3", tenantId: "t1", userId: "u1", jti: "c", via: "sso", expiresAt: future });
    const r = await svc.revokeOthers(me);
    expect(r.revoked).toBe(2);
    expect(rows.find((x) => x.id === "s-cur").revokedAt).toBeNull();
    expect(rows.filter((x) => x.revokedAt).map((x) => x.id).sort()).toEqual(["s-2", "s-3"]);
  });

  it("yönetici: rol kapısı, kiracı sınırı, listeleme ve kapatma", async () => {
    const { svc, rows, future, audit } = build();
    await svc.record({ id: "s-u2", tenantId: "t1", userId: "u2", jti: "b", via: "parola", expiresAt: future, meta: { userAgent: "okhttp/4.12" } });
    await expect(svc.listForUser(me, "u2")).rejects.toThrow();
    await expect(svc.listForUser(admin, "u9")).rejects.toThrow(/Kullanıcı bulunamadı/);
    const { items } = await svc.listForUser(admin, "u2");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ deviceLabel: "NomosOS mobil (Android)", current: false });
    await svc.revokeForUser(admin, "u2", "s-u2");
    expect(rows[0].revokedBy).toBe("u-adm");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "SESSION_REVOKE", detail: expect.stringContaining("veli@buro.com") }));
    await expect(svc.revokeForUser(admin, "u2", "s-u2")).rejects.toThrow(/bulunamadı/);
  });

  it("purgeStale: 30 günden eski süresi dolmuş/iptal kayıtlar silinir, açıklar kalır", async () => {
    const { svc, rows, future } = build();
    const now = new Date();
    await svc.record({ id: "s-live", tenantId: "t1", userId: "u1", jti: "a", via: "parola", expiresAt: future });
    await svc.record({ id: "s-old", tenantId: "t1", userId: "u1", jti: "b", via: "parola", expiresAt: new Date(now.getTime() - 40 * 24 * 3_600_000) });
    await svc.record({ id: "s-rev", tenantId: "t1", userId: "u1", jti: "c", via: "parola", expiresAt: future });
    rows[2].revokedAt = new Date(now.getTime() - 31 * 24 * 3_600_000);
    await svc.record({ id: "s-rev-new", tenantId: "t1", userId: "u1", jti: "d", via: "parola", expiresAt: future });
    rows[3].revokedAt = new Date(now.getTime() - 1 * 24 * 3_600_000);
    expect(await svc.purgeStale(now)).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["s-live", "s-rev-new"]);
  });
});
