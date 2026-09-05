/**
 * TenantStatusGuard — Faz 0 gelir kaçağı kapatma:
 *  - Süresi dolmuş TRIAL ve tolerans (SUBSCRIPTION_GRACE_DAYS=14) sonrası PAST_DUE yazma isteklerinde 402;
 *    GET ve /auth, /billing, /credits yolları açık kalır (veri rehin alınmaz).
 *  - SUSPENDED/CANCELED eski davranış (403) korunur; ACTIVE ve süresi dolmamış TRIAL geçer.
 */
import { describe, expect, it, vi } from "vitest";
import { TenantStatusGuard } from "./tenant-status.guard";

const DAY = 24 * 3_600_000;

function build(sub: Record<string, unknown> | null) {
  const prisma = {
    client: {
      subscription: { findUnique: vi.fn(async () => sub) },
      systemSetting: { findUnique: vi.fn(async () => null) },
    },
  };
  const guard = new TenantStatusGuard({ getAllAndOverride: () => false } as any, prisma as any);
  const ctx = (method: string, path: string) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ method, path, user: { userId: "u1", tenantId: "t1", role: "ADMIN" } }) }),
    }) as any;
  return { guard, ctx };
}

async function status(guard: TenantStatusGuard, c: any): Promise<number | true> {
  try {
    await guard.canActivate(c);
    return true;
  } catch (err) {
    return (err as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
}

describe("TenantStatusGuard — deneme süresi ve ödeme gecikmesi", () => {
  it("süresi dolmuş TRIAL: yazma 402, okuma/auth/billing açık", async () => {
    const { guard, ctx } = build({ status: "TRIAL", trialEndsAt: new Date(Date.now() - DAY), currentPeriodEnd: null });
    expect(await status(guard, ctx("POST", "/api/v1/cases"))).toBe(402);
    expect(await status(guard, ctx("PATCH", "/api/v1/cases/x"))).toBe(402);
    expect(await status(guard, ctx("GET", "/api/v1/cases"))).toBe(true);
    expect(await status(guard, ctx("POST", "/api/v1/auth/logout"))).toBe(true);
    expect(await status(guard, ctx("POST", "/api/v1/billing/checkout"))).toBe(true);
    expect(await status(guard, ctx("POST", "/api/v1/credits/purchase"))).toBe(true);
  });

  it("süresi dolmamış TRIAL ve ACTIVE geçer", async () => {
    const trial = build({ status: "TRIAL", trialEndsAt: new Date(Date.now() + DAY), currentPeriodEnd: null });
    expect(await status(trial.guard, trial.ctx("POST", "/api/v1/cases"))).toBe(true);
    const active = build({ status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 10 * DAY) });
    expect(await status(active.guard, active.ctx("POST", "/api/v1/cases"))).toBe(true);
  });

  it("PAST_DUE: tolerans içinde geçer, 14 gün sonra yazma 402", async () => {
    const inGrace = build({ status: "PAST_DUE", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() - 3 * DAY) });
    expect(await status(inGrace.guard, inGrace.ctx("POST", "/api/v1/cases"))).toBe(true);
    const late = build({ status: "PAST_DUE", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() - 15 * DAY) });
    expect(await status(late.guard, late.ctx("POST", "/api/v1/cases"))).toBe(402);
    expect(await status(late.guard, late.ctx("GET", "/api/v1/cases"))).toBe(true);
  });

  it("SUSPENDED/CANCELED eski davranış: yazma 403; aboneliği olmayan kiracı engellenmez", async () => {
    const s = build({ status: "SUSPENDED", trialEndsAt: null, currentPeriodEnd: null });
    expect(await status(s.guard, s.ctx("POST", "/api/v1/cases"))).toBe(403);
    const none = build(null);
    expect(await status(none.guard, none.ctx("POST", "/api/v1/cases"))).toBe(true);
  });

  it("platform paneli yolları guard dışıdır", async () => {
    const { guard, ctx } = build({ status: "CANCELED", trialEndsAt: null, currentPeriodEnd: null });
    expect(await status(guard, ctx("POST", "/api/admin/v1/tenants"))).toBe(true);
  });
});
