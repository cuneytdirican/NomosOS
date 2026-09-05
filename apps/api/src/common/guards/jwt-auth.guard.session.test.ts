/**
 * JwtAuthGuard — `jti` oturum kaydı: iptal edilmiş/eksik oturum 401; geçerli
 * oturumda request.user.sessionId dolar; lastSeenAt seyrek tazelenir; eski
 * (jti'siz) token geriye uyumlu.
 */

import { describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "./jwt-auth.guard";

function build(session: Record<string, unknown> | null, jti: string | null = "j1") {
  const prisma = {
    client: {
      user: {
        findUnique: vi.fn(async () => ({ id: "u1", tenantId: "t1", role: "AVUKAT", isActive: true, sessionsValidFrom: null })),
      },
      userSession: {
        findUnique: vi.fn(async ({ where }: any) => (session && where.jti === "j1" ? session : null)),
        update: vi.fn(async () => ({})),
      },
      apiKey: { findUnique: vi.fn() },
    },
  };
  const jwt = { verifyAsync: vi.fn(async () => ({ sub: "u1", tenantId: "t1", role: "AVUKAT", aud: "tenant", iat: Math.floor(Date.now() / 1000), ...(jti ? { jti } : {}) })) };
  const guard = new JwtAuthGuard({ getAllAndOverride: () => false } as any, jwt as any, prisma as any);
  const request: any = { headers: { authorization: "Bearer x" }, method: "GET", path: "/api/v1/cases", cookies: {} };
  const ctx = { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => request }) } as any;
  return { guard, prisma, request, ctx };
}

describe("JwtAuthGuard — cihaz oturumu (jti)", () => {
  it("geçerli oturum → sessionId; lastSeenAt 5 dk'dan eskiyse tazelenir", async () => {
    const { guard, prisma, request, ctx } = build({ id: "s1", revokedAt: null, lastSeenAt: new Date(Date.now() - 10 * 60_000) });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(request.user).toMatchObject({ userId: "u1", sessionId: "s1" });
    expect(prisma.client.userSession.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "s1" } }));
  });

  it("taze lastSeenAt → yazılmaz; ikinci istek önbellekten (tek sorgu)", async () => {
    const { guard, prisma, ctx } = build({ id: "s1", revokedAt: null, lastSeenAt: new Date() });
    await guard.canActivate(ctx);
    await guard.canActivate(ctx);
    expect(prisma.client.userSession.update).not.toHaveBeenCalled();
    expect(prisma.client.userSession.findUnique).toHaveBeenCalledTimes(1);
  });

  it("iptal edilmiş oturum → 401; kayıt yok → 401", async () => {
    const revoked = build({ id: "s1", revokedAt: new Date(), lastSeenAt: new Date() });
    await expect(revoked.guard.canActivate(revoked.ctx)).rejects.toThrow(/kapatılmış/);
    const missing = build(null);
    await expect(missing.guard.canActivate(missing.ctx)).rejects.toThrow(/bulunamadı/);
  });

  it("jti'siz eski token geriye uyumlu: oturum sorgusu yok, sessionId yok", async () => {
    const { guard, prisma, request, ctx } = build(null, null);
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(request.user.sessionId).toBeUndefined();
    expect(prisma.client.userSession.findUnique).not.toHaveBeenCalled();
  });
});
