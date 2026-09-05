/**
 * JwtAuthGuard — X-Api-Key yolu: özet eşleşmesi, iptal/süre, salt-okunur
 * (GET/HEAD), kapsam-yol kontrolü, kimlik apikey:<id> + rol AVUKAT.
 */

import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { hashApiKey } from "../../integrations/api-keys.service";

const PLAIN = "nos_deadbeef_0123456789abcdef0123456789abcdef01234567";

function build(row: Record<string, unknown> | null) {
  const prisma = {
    client: {
      apiKey: {
        findUnique: vi.fn(async ({ where }: any) => (row && where.keyHash === hashApiKey(PLAIN) ? row : null)),
        update: vi.fn(async () => ({})),
      },
      user: { findUnique: vi.fn() },
    },
  };
  const guard = new JwtAuthGuard({ getAllAndOverride: () => false } as any, { verify: vi.fn() } as any, prisma as any);
  const ctx = (method: string, path: string, key = PLAIN) => {
    const request = { headers: { "x-api-key": key }, method, path, cookies: {} };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
      request,
    } as any;
  };
  return { guard, prisma, ctx };
}

const liveRow = { id: "k1", tenantId: "t1", scopes: "cases:read,agenda:read", revokedAt: null, expiresAt: null, lastUsedAt: null };

describe("JwtAuthGuard — API anahtarı", () => {
  it("geçerli anahtar + GET + kapsam içi yol → apikey kimliği, rol AVUKAT, lastUsedAt güncellenir", async () => {
    const { guard, prisma, ctx } = build(liveRow);
    const c = ctx("GET", "/api/v1/cases/abc");
    expect(await guard.canActivate(c)).toBe(true);
    expect(c.request.user).toEqual({ userId: "apikey:k1", tenantId: "t1", role: "AVUKAT", apiKeyId: "k1" });
    expect(prisma.client.apiKey.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "k1" } }));
  });

  it("bilinmeyen / iptal / süresi dolmuş anahtar → 401", async () => {
    const unknown = build(null);
    await expect(unknown.guard.canActivate(unknown.ctx("GET", "/api/v1/cases"))).rejects.toThrow(UnauthorizedException);
    const revoked = build({ ...liveRow, revokedAt: new Date() });
    await expect(revoked.guard.canActivate(revoked.ctx("GET", "/api/v1/cases"))).rejects.toThrow(/iptal/);
    const expired = build({ ...liveRow, expiresAt: new Date(Date.now() - 1000) });
    await expect(expired.guard.canActivate(expired.ctx("GET", "/api/v1/cases"))).rejects.toThrow(/süresi/);
  });

  it("yazma yöntemi → 401 (salt-okunur)", async () => {
    const { guard, ctx } = build(liveRow);
    await expect(guard.canActivate(ctx("POST", "/api/v1/cases"))).rejects.toThrow(/salt-okunur/);
    await expect(guard.canActivate(ctx("DELETE", "/api/v1/cases/x"))).rejects.toThrow(/salt-okunur/);
  });

  it("kapsam dışı yol → 401; entegrasyon yönetimi anahtarla yapılamaz", async () => {
    const { guard, ctx } = build(liveRow);
    await expect(guard.canActivate(ctx("GET", "/api/v1/clients"))).rejects.toThrow(/kapsam/);
    await expect(guard.canActivate(ctx("GET", "/api/v1/integrations/api-keys"))).rejects.toThrow(/kapsam/);
    await expect(guard.canActivate(ctx("GET", "/api/v1/security/audit"))).rejects.toThrow(/kapsam/);
  });

  it("lastUsedAt son 1 dk içindeyse tekrar yazılmaz", async () => {
    const { guard, prisma, ctx } = build({ ...liveRow, lastUsedAt: new Date() });
    await guard.canActivate(ctx("GET", "/api/v1/agenda"));
    expect(prisma.client.apiKey.update).not.toHaveBeenCalled();
  });
});
