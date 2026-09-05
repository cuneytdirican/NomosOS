import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { InProcessCounterStore, setCounterStore } from "../rate-limit/counter-store";
import { GlobalRateLimitGuard, globalLimits, isExemptPath } from "./global-rate-limit.guard";

function ctx(path: string, user?: { userId: string }, ip = "9.9.9.9") {
  const headers: Record<string, string> = {};
  return {
    headers,
    context: {
      switchToHttp: () => ({
        getRequest: () => ({ method: "GET", originalUrl: path, url: path, ip, user }),
        getResponse: () => ({ setHeader: (k: string, v: string) => { headers[k] = v; } }),
      }),
    } as unknown as ExecutionContext,
  };
}

describe("GlobalRateLimitGuard", () => {
  const env = { ...process.env };
  beforeEach(() => {
    setCounterStore(new InProcessCounterStore());
    process.env.RATE_LIMIT_GLOBAL_PER_IP = "3";
    process.env.RATE_LIMIT_GLOBAL_PER_USER = "5";
  });
  afterEach(() => {
    process.env = { ...env };
    setCounterStore(null);
  });

  it("limits/exempt saf yardımcıları", () => {
    expect(globalLimits({} as NodeJS.ProcessEnv)).toEqual({ perIp: 300, perUser: 600 });
    expect(globalLimits({ RATE_LIMIT_GLOBAL_PER_IP: "0", RATE_LIMIT_GLOBAL_PER_USER: "abc" } as NodeJS.ProcessEnv)).toEqual({ perIp: 0, perUser: 600 });
    expect(isExemptPath("/api/v1/health/ready")).toBe(true);
    expect(isExemptPath("/metrics")).toBe(true);
    expect(isExemptPath("/api/v1/billing/odeme/webhook")).toBe(true);
    expect(isExemptPath("/api/v1/cases")).toBe(false);
  });

  it("IP başına 3: dördüncü istek 429 + Retry-After; farklı IP etkilenmez; sağlık ucu muaf", async () => {
    const guard = new GlobalRateLimitGuard();
    for (let i = 0; i < 3; i++) expect(await guard.canActivate(ctx("/api/v1/cases").context)).toBe(true);
    const c = ctx("/api/v1/cases");
    await expect(guard.canActivate(c.context)).rejects.toThrow(HttpException);
    expect(c.headers["Retry-After"]).toBeTruthy();
    expect(c.headers["X-RateLimit-Remaining"]).toBe("0");
    expect(await guard.canActivate(ctx("/api/v1/cases", undefined, "8.8.8.8").context)).toBe(true);
    expect(await guard.canActivate(ctx("/api/v1/health/live").context)).toBe(true);
  });

  it("kimlikli istek kullanıcı anahtarıyla sayılır (5); limit 0 = kapalı", async () => {
    const guard = new GlobalRateLimitGuard();
    for (let i = 0; i < 5; i++) expect(await guard.canActivate(ctx("/api/v1/x", { userId: "u1" }).context)).toBe(true);
    await expect(guard.canActivate(ctx("/api/v1/x", { userId: "u1" }).context)).rejects.toThrow("dakikada en fazla 5");
    process.env.RATE_LIMIT_GLOBAL_PER_USER = "0";
    expect(await guard.canActivate(ctx("/api/v1/x", { userId: "u1" }).context)).toBe(true);
  });

  it("sayaç deposu patlarsa istek geçer (fail-open)", async () => {
    setCounterStore({ kind: "surec-ici", increment: async () => { throw new Error("redis kapalı"); }, decrement: async () => undefined, reset: async () => undefined });
    expect(await new GlobalRateLimitGuard().canActivate(ctx("/api/v1/x").context)).toBe(true);
  });
});
