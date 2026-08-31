import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpException } from "@nestjs/common";
import { AiRateLimitGuard } from "./ai-rate-limit.guard";
import { InProcessCounterStore, setCounterStore } from "../rate-limit/counter-store";
import type { AuthUser } from "../types";

/**
 * REGRESYON — denetim bulguları Ö-09 ve Ö-10.
 *
 * Ö-10: sınır kullanıcı+rota bazındaydı; 10 kullanıcılı bir büro, uç sayısıyla
 *       da çarparak tavanı katlıyordu. Artık rotadan BAĞIMSIZ bir büro kovası
 *       vardır ve testler tam olarak bunu kanıtlar.
 * Ö-09: sayaç süreç-içi `Map` yerine değiştirilebilir bir arayüzün arkasında.
 *       Test bu arayüzü enjekte edebiliyorsa üretimde Redis de enjekte
 *       edilebilir demektir.
 */

/** `@AiThrottle(n)` metadata'sını taklit eden en küçük Reflector. */
function reflectorWithCost(cost: number) {
  return { getAllAndOverride: () => cost } as unknown as ConstructorParameters<
    typeof AiRateLimitGuard
  >[0];
}

function ctx(user: AuthUser | undefined, routePath: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, route: { path: routePath } }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as Parameters<AiRateLimitGuard["canActivate"]>[0];
}

const ENV_KEYS = [
  "AI_RATE_LIMIT_PER_MINUTE",
  "AI_RATE_LIMIT_PER_DAY",
  "AI_RATE_LIMIT_TENANT_PER_MINUTE",
  "AI_RATE_LIMIT_TENANT_PER_DAY",
] as const;

function user(id: string, tenantId = "buro-a"): AuthUser {
  return { userId: id, tenantId, role: "AVUKAT" as AuthUser["role"] };
}

describe("AiRateLimitGuard — büro bazlı tavan (Ö-10)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setCounterStore(new InProcessCounterStore());
    // Kullanıcı sınırı geniş, büro sınırı dar: ölçülen şey YALNIZ büro kovası.
    process.env.AI_RATE_LIMIT_PER_MINUTE = "1000";
    process.env.AI_RATE_LIMIT_PER_DAY = "1000";
    process.env.AI_RATE_LIMIT_TENANT_PER_MINUTE = "5";
    process.env.AI_RATE_LIMIT_TENANT_PER_DAY = "1000";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
    setCounterStore(null);
  });

  it("AYNI BÜRODAKİ FARKLI KULLANICILAR ORTAK TAVANI PAYLAŞIR", async () => {
    const guard = new AiRateLimitGuard(reflectorWithCost(1));
    // Beş ayrı kullanıcı, beş ayrı çağrı — büro tavanı (5) tam dolar.
    for (let i = 1; i <= 5; i += 1) {
      await expect(guard.canActivate(ctx(user(`avukat-${i}`), "/assistant/chat"))).resolves.toBe(
        true,
      );
    }
    // Altıncı kullanıcı: kendi kotasına hiç dokunmamıştır, yine de reddedilir.
    await expect(guard.canActivate(ctx(user("avukat-6"), "/assistant/chat"))).rejects.toThrow(
      HttpException,
    );
  });

  it("BÜRO KOVASI ROTADAN BAĞIMSIZDIR — uç değiştirerek tavan aşılamaz", async () => {
    const guard = new AiRateLimitGuard(reflectorWithCost(1));
    const routes = [
      "/assistant/chat",
      "/caselaw/ai-search",
      "/petitions/:id/generate",
      "/contracts/:id/analyze",
      "/conflict/check",
    ];
    for (const route of routes) {
      await expect(guard.canActivate(ctx(user("avukat-1"), route))).resolves.toBe(true);
    }
    // Altıncı farklı uç: eski kod BURADA GEÇİYORDU (her rota ayrı kovaydı).
    await expect(guard.canActivate(ctx(user("avukat-1"), "/documents/ai-summary"))).rejects.toThrow(
      /Büronuzun dakikalık AI çağrı tavanına/,
    );
  });

  it("başka büro etkilenmez (kiracı izolasyonu)", async () => {
    const guard = new AiRateLimitGuard(reflectorWithCost(1));
    for (let i = 0; i < 5; i += 1) {
      await guard.canActivate(ctx(user(`a-${i}`, "buro-a"), "/assistant/chat"));
    }
    await expect(guard.canActivate(ctx(user("a-x", "buro-a"), "/assistant/chat"))).rejects.toThrow();
    await expect(
      guard.canActivate(ctx(user("b-1", "buro-b"), "/assistant/chat")),
    ).resolves.toBe(true);
  });

  it("çok çağrılı uçlar maliyeti kadar yer (@AiThrottle(6))", async () => {
    const guard = new AiRateLimitGuard(reflectorWithCost(6));
    // Tavan 5; tek istek 6 çağrı sayar → ilk istekte reddedilir.
    await expect(guard.canActivate(ctx(user("avukat-1"), "/caselaw/ai-search"))).rejects.toThrow(
      HttpException,
    );
  });

  it("REDDEDİLEN İSTEK KULLANICI KOTASINDAN YEMEZ", async () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = "10";
    const guard = new AiRateLimitGuard(reflectorWithCost(1));
    // Büro tavanını başka kullanıcılarla doldur.
    for (let i = 1; i <= 5; i += 1) {
      await guard.canActivate(ctx(user(`baska-${i}`), "/assistant/chat"));
    }
    // Bu kullanıcı büro tavanına takılır…
    await expect(guard.canActivate(ctx(user("kurban"), "/assistant/chat"))).rejects.toThrow();

    // …ve kendi dakikalık kotası harcanmamış olmalı. Büro tavanını yükseltip
    // aynı kullanıcıyla 10 istek atabiliyorsak geri alma çalışmış demektir.
    process.env.AI_RATE_LIMIT_TENANT_PER_MINUTE = "1000";
    for (let i = 0; i < 10; i += 1) {
      await expect(guard.canActivate(ctx(user("kurban"), "/assistant/chat"))).resolves.toBe(true);
    }
    await expect(guard.canActivate(ctx(user("kurban"), "/assistant/chat"))).rejects.toThrow(
      /dakikada en fazla 10 çağrı/,
    );
  });

  it("kullanıcı bazlı sınır KORUNUR (büro tavanı onun yerine geçmez)", async () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = "2";
    process.env.AI_RATE_LIMIT_TENANT_PER_MINUTE = "1000";
    const guard = new AiRateLimitGuard(reflectorWithCost(1));
    await guard.canActivate(ctx(user("avukat-1"), "/assistant/chat"));
    await guard.canActivate(ctx(user("avukat-1"), "/assistant/chat"));
    await expect(guard.canActivate(ctx(user("avukat-1"), "/assistant/chat"))).rejects.toThrow(
      /dakikada en fazla 2 çağrı/,
    );
    // Aynı büroda BAŞKA kullanıcı etkilenmez.
    await expect(guard.canActivate(ctx(user("avukat-2"), "/assistant/chat"))).resolves.toBe(true);
  });

  it("kimliksiz istek sayaca hiç dokunmaz (JwtAuthGuard'ın işi)", async () => {
    const guard = new AiRateLimitGuard(reflectorWithCost(1));
    await expect(guard.canActivate(ctx(undefined, "/assistant/chat"))).resolves.toBe(true);
  });
});

describe("RateLimitCounterStore (Ö-09)", () => {
  it("pencere dolunca sayaç sıfırlanır", async () => {
    const store = new InProcessCounterStore();
    const first = await store.increment("k", 50, 1);
    expect(first.count).toBe(1);
    const second = await store.increment("k", 50, 1);
    expect(second.count).toBe(2);
    await new Promise((r) => setTimeout(r, 60));
    const third = await store.increment("k", 50, 1);
    expect(third.count).toBe(1);
  });

  it("decrement sayacı negatife düşüremez", async () => {
    const store = new InProcessCounterStore();
    await store.increment("k", 1000, 1);
    await store.decrement("k", 5);
    const after = await store.increment("k", 1000, 1);
    expect(after.count).toBe(1);
  });
});
