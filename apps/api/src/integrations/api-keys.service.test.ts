/**
 * API anahtarları: üretim biçimi, özet saklama (düz anahtar DB'ye yazılmaz),
 * kapsam doğrulaması, rol kapısı, iptal + denetim izi.
 */

import { describe, expect, it, vi } from "vitest";
import { ApiKeysService, generateApiKey, hashApiKey } from "./api-keys.service";
import { pathAllowedByScopes } from "./webhook-events";

const admin = { userId: "u1", tenantId: "t1", role: "ADMIN" as const };
const avukat = { userId: "u2", tenantId: "t1", role: "AVUKAT" as const };

function build() {
  const rows: any[] = [];
  const prisma = {
    client: {
      apiKey: {
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `k${rows.length + 1}`, revokedAt: null, ...data };
          rows.push(row);
          return row;
        }),
        findMany: vi.fn(async () => rows),
        findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
        update: vi.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
      },
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  return { svc: new ApiKeysService(prisma as any, audit as any), prisma, audit, rows };
}

describe("generateApiKey / hashApiKey", () => {
  it("nos_<8hex>_<40hex> biçimi; özet 64 hex ve deterministik", () => {
    const { plain, prefix } = generateApiKey();
    expect(plain).toMatch(/^nos_[0-9a-f]{8}_[0-9a-f]{40}$/);
    expect(plain.split("_")[1]).toBe(prefix);
    expect(hashApiKey(plain)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(plain)).toBe(hashApiKey(plain));
    expect(hashApiKey(plain)).not.toBe(hashApiKey(generateApiKey().plain));
  });
});

describe("pathAllowedByScopes", () => {
  it("kapsam öneki ve alt yollar; kapsam dışı reddedilir", () => {
    expect(pathAllowedByScopes("/api/v1/cases", ["cases:read"])).toBe(true);
    expect(pathAllowedByScopes("/api/v1/cases/abc/members", ["cases:read"])).toBe(true);
    expect(pathAllowedByScopes("/api/v1/clients", ["cases:read"])).toBe(false);
    expect(pathAllowedByScopes("/api/v1/casesX", ["cases:read"])).toBe(false);
    expect(pathAllowedByScopes("/api/v1/integrations/api-keys", ["cases:read", "clients:read"])).toBe(false);
    expect(pathAllowedByScopes("/api/v1/cases", ["bilinmeyen:read"])).toBe(false);
  });
});

describe("ApiKeysService", () => {
  it("create: düz anahtar yalnız yanıtta; DB'de yalnız özet + prefix; denetim yazılır", async () => {
    const { svc, rows, audit } = build();
    const res = await svc.create(admin, { name: "Muhasebe", scopes: ["cases:read", "cases:read", "clients:read"] });
    expect(res.plainKey).toMatch(/^nos_/);
    expect(res.scopes).toEqual(["cases:read", "clients:read"]);
    expect(rows[0].keyHash).toBe(hashApiKey(res.plainKey));
    expect(JSON.stringify(rows[0])).not.toContain(res.plainKey);
    expect(rows[0].keyPrefix).toBe(res.plainKey.split("_")[1]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "API_KEY_CREATE", entityId: "k1" }));
  });

  it("create: geçersiz kapsam / boş kapsam / bozuk tarih reddedilir", async () => {
    const { svc } = build();
    await expect(svc.create(admin, { name: "x", scopes: [] })).rejects.toThrow(/kapsam/i);
    await expect(svc.create(admin, { name: "x", scopes: ["cases:write"] })).rejects.toThrow(/Geçersiz kapsam/);
    await expect(svc.create(admin, { name: "x", scopes: ["cases:read"], expiresAt: "dun" })).rejects.toThrow(/tarih/i);
  });

  it("rol kapısı: AVUKAT listeleyemez / oluşturamaz", async () => {
    const { svc } = build();
    await expect(svc.list(avukat)).rejects.toThrow();
    await expect(svc.create(avukat, { name: "x", scopes: ["cases:read"] })).rejects.toThrow();
  });

  it("list: maskeli gösterim, kapsamlar dizi", async () => {
    const { svc } = build();
    await svc.create(admin, { name: "A", scopes: ["cases:read"] });
    const out = await svc.list(admin);
    expect(out.items[0].masked).toMatch(/^nos_[0-9a-f]{8}_••••$/);
    expect(out.items[0].scopes).toEqual(["cases:read"]);
    expect(out.scopes.map((s) => s.key)).toContain("agenda:read");
  });

  it("revoke: revokedAt yazılır, denetim düşer; başka kiracının anahtarı 404; tekrar iptal idempotent", async () => {
    const { svc, rows, audit } = build();
    await svc.create(admin, { name: "A", scopes: ["cases:read"] });
    await svc.revoke(admin, "k1");
    expect(rows[0].revokedAt).toBeInstanceOf(Date);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "API_KEY_REVOKE" }));
    audit.log.mockClear();
    await svc.revoke(admin, "k1");
    expect(audit.log).not.toHaveBeenCalled();
    await expect(svc.revoke({ ...admin, tenantId: "t2" }, "k1")).rejects.toThrow(/bulunamadı/);
  });
});
