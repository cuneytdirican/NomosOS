import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import { ReadinessService } from "./readiness.service";

describe("ReadinessService", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("DB + S3 ayakta, Redis tanımsız → ready (redis disabled)", async () => {
    delete process.env.REDIS_URL;
    const prisma = { client: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } } as unknown as PrismaService;
    const storage = { ensureBucket: vi.fn(async () => undefined) } as unknown as StorageService;
    const r = await new ReadinessService(prisma, storage).check();
    expect(r.status).toBe("ready");
    expect(r.checks.postgres.status).toBe("up");
    expect(r.checks.s3.status).toBe("up");
    expect(r.checks.redis.status).toBe("disabled");
  });

  it("DB düşükse degraded + gerekçe; S3 düşükse degraded", async () => {
    delete process.env.REDIS_URL;
    const prismaDown = { client: { $queryRaw: vi.fn(async () => { throw new Error("ECONNREFUSED 5432"); }) } } as unknown as PrismaService;
    const storage = { ensureBucket: vi.fn(async () => undefined) } as unknown as StorageService;
    const r = await new ReadinessService(prismaDown, storage).check();
    expect(r.status).toBe("degraded");
    expect(r.checks.postgres).toMatchObject({ status: "down" });
    expect(r.checks.postgres.detail).toContain("ECONNREFUSED");

    const prismaUp = { client: { $queryRaw: vi.fn(async () => []) } } as unknown as PrismaService;
    const s3Down = { ensureBucket: vi.fn(async () => { throw new Error("NoSuchBucket"); }) } as unknown as StorageService;
    expect((await new ReadinessService(prismaUp, s3Down).check()).status).toBe("degraded");
  });
});
