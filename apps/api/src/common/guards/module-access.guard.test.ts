import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { PrismaService } from "../../prisma/prisma.service";
import { ModuleAccessGuard, moduleAllowed } from "./module-access.guard";

function ctx(opts: { required?: string; isPublic?: boolean; path?: string; user?: { tenantId: string } | null }) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => (key === "nomosos:requiresModule" ? opts.required : key === "isPublic" ? opts.isPublic : undefined)),
  } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ path: opts.path ?? "/api/v1/enforcement", user: opts.user === undefined ? { tenantId: "t1" } : opts.user }) }),
  } as unknown as ExecutionContext;
  return { reflector, context };
}

function prismaWith(planKey: string | null, modules: string[] | null | "bozuk") {
  return {
    client: {
      subscription: { findUnique: vi.fn(async () => (planKey ? { planKey } : null)) },
      planTier: {
        findUnique: vi.fn(async () => ({ name: "Solo", featuresJson: modules === "bozuk" ? "{" : JSON.stringify(modules === null ? {} : { modules }) })),
      },
    },
  } as unknown as PrismaService;
}

describe("moduleAllowed", () => {
  it("liste yoksa serbest; varsa içermeli", () => {
    expect(moduleAllowed(null, "icra")).toBe(true);
    expect(moduleAllowed(["dosya"], "icra")).toBe(false);
    expect(moduleAllowed(["dosya", "icra"], "icra")).toBe(true);
  });
});

describe("ModuleAccessGuard", () => {
  it("dekoratör yoksa geçer; @Public geçer; admin yolu geçer; kullanıcısız geçer", async () => {
    const prisma = prismaWith("SOLO", ["dosya"]);
    let c = ctx({});
    expect(await new ModuleAccessGuard(c.reflector, prisma).canActivate(c.context)).toBe(true);
    c = ctx({ required: "icra", isPublic: true });
    expect(await new ModuleAccessGuard(c.reflector, prisma).canActivate(c.context)).toBe(true);
    c = ctx({ required: "icra", path: "/api/admin/v1/x" });
    expect(await new ModuleAccessGuard(c.reflector, prisma).canActivate(c.context)).toBe(true);
    c = ctx({ required: "icra", user: null });
    expect(await new ModuleAccessGuard(c.reflector, prisma).canActivate(c.context)).toBe(true);
  });

  it("plan modülü yoksa 403 + plan adı; varsa geçer; abonelik/plan yoksa kısıt yok; bozuk JSON kısıt yok", async () => {
    let c = ctx({ required: "icra" });
    await expect(new ModuleAccessGuard(c.reflector, prismaWith("SOLO", ["dosya", "sure"])).canActivate(c.context)).rejects.toThrow(ForbiddenException);
    await expect(new ModuleAccessGuard(c.reflector, prismaWith("SOLO", ["dosya", "sure"])).canActivate(c.context)).rejects.toThrow("Solo");
    c = ctx({ required: "icra" });
    expect(await new ModuleAccessGuard(c.reflector, prismaWith("BURO", ["dosya", "icra"])).canActivate(c.context)).toBe(true);
    expect(await new ModuleAccessGuard(c.reflector, prismaWith(null, null)).canActivate(c.context)).toBe(true);
    expect(await new ModuleAccessGuard(c.reflector, prismaWith("X", "bozuk")).canActivate(c.context)).toBe(true);
  });

  it("60 sn önbellek: aynı kiracı için ikinci istekte DB'ye gidilmez; invalidate temizler", async () => {
    const prisma = prismaWith("BURO", ["icra"]);
    const c = ctx({ required: "icra" });
    const guard = new ModuleAccessGuard(c.reflector, prisma);
    await guard.canActivate(c.context);
    await guard.canActivate(c.context);
    expect((prisma.client.subscription.findUnique as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    guard.invalidate("t1");
    await guard.canActivate(c.context);
    expect((prisma.client.subscription.findUnique as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});
