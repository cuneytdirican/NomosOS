/**
 * Webhook'lar: denetim izi fan-out (yalnız katalog + abone uç), SSRF/HTTPS
 * kapısı, HMAC imza, dağıtım (2xx → GONDERILDI; hata → geri çekilme
 * merdiveni → BASARISIZ), pasif uç, test teslimatı.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nomosos/ai", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
  validateProviderBaseUrl: (url: string) => {
    if (/localhost|127\.0\.0\.1|169\.254|10\.\d+/.test(url)) return { ok: false, message: "Özel ağ adresi reddedildi." };
    return { ok: true };
  },
}));

import { createHmac } from "node:crypto";
import { WEBHOOK_BACKOFF_MS, WEBHOOK_MAX_ATTEMPTS, WebhooksService, nextAttemptAfter, signWebhookBody } from "./webhooks.service";
import { WEBHOOK_TEST_EVENT } from "./webhook-events";

const admin = { userId: "u1", tenantId: "t1", role: "PARTNER" as const };

function build() {
  const endpoints: any[] = [];
  const deliveries: any[] = [];
  const prisma = {
    client: {
      webhookEndpoint: {
        findMany: vi.fn(async ({ where }: any) =>
          endpoints.filter((e) => e.tenantId === where.tenantId && (where.isActive === undefined || e.isActive === where.isActive)),
        ),
        findFirst: vi.fn(async ({ where }: any) => endpoints.find((e) => e.id === where.id && e.tenantId === where.tenantId) ?? null),
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `w${endpoints.length + 1}`, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...data };
          endpoints.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => Object.assign(endpoints.find((e) => e.id === where.id), data)),
        delete: vi.fn(async ({ where }: any) => endpoints.splice(endpoints.findIndex((e) => e.id === where.id), 1)[0]),
      },
      webhookDelivery: {
        create: vi.fn(async ({ data }: any) => {
          const row = { status: "BEKLIYOR", attempts: 0, nextAttemptAt: new Date(0), ...data };
          deliveries.push(row);
          return row;
        }),
        findMany: vi.fn(async ({ where, include }: any) => {
          let out = deliveries.filter(
            (d) =>
              (where.status ? d.status === where.status : true) &&
              (where.nextAttemptAt ? d.nextAttemptAt <= where.nextAttemptAt.lte : true) &&
              (where.endpointId ? d.endpointId === where.endpointId : true),
          );
          if (include?.endpoint) out = out.map((d) => ({ ...d, endpoint: endpoints.find((e) => e.id === d.endpointId) }));
          return out;
        }),
        update: vi.fn(async ({ where, data }: any) => Object.assign(deliveries.find((d) => d.id === where.id), data)),
        groupBy: vi.fn(async () => []),
      },
    },
  };
  const listeners: any[] = [];
  const audit = { log: vi.fn(async () => undefined), subscribe: vi.fn((l: any) => listeners.push(l)) };
  const svc = new WebhooksService(prisma as any, audit as any);
  return { svc, prisma, audit, endpoints, deliveries, listeners };
}

describe("imza ve geri çekilme", () => {
  it("signWebhookBody = sha256=HMAC(sır, gövde)", () => {
    const body = '{"a":1}';
    expect(signWebhookBody("s3cret", body)).toBe(`sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`);
  });
  it("nextAttemptAfter merdiveni: 1dk,5dk,30dk,2sa,12sa; 6. denemeden sonra yok", () => {
    const now = new Date("2026-09-24T10:00:00Z");
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(5);
    WEBHOOK_BACKOFF_MS.forEach((ms, i) => expect(nextAttemptAfter(i + 1, now)!.getTime() - now.getTime()).toBe(ms));
    expect(nextAttemptAfter(6, now)).toBeNull();
  });
});

describe("WebhooksService — yönetim", () => {
  it("onModuleInit denetim izine abone olur", () => {
    const { svc, audit } = build();
    svc.onModuleInit();
    expect(audit.subscribe).toHaveBeenCalledTimes(1);
  });

  it("create: HTTPS zorunlu, SSRF reddi, katalog dışı olay reddi; sır şifreli saklanır ve bir kez döner", async () => {
    const { svc, endpoints } = build();
    await expect(svc.create(admin, { url: "http://example.com/h", events: ["CASE_CREATE"] })).rejects.toThrow(/HTTPS/);
    await expect(svc.create(admin, { url: "https://127.0.0.1/h", events: ["CASE_CREATE"] })).rejects.toThrow(/Özel ağ/);
    await expect(svc.create(admin, { url: "https://example.com/h", events: ["USER_LOGIN"] })).rejects.toThrow(/Katalog dışı/);
    const res = await svc.create(admin, { url: "https://example.com/h", events: ["CASE_CREATE", "CASE_CREATE", "HEARING_CREATE"] });
    expect(res.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(res.events).toEqual(["CASE_CREATE", "HEARING_CREATE"]);
    expect(endpoints[0].encryptedSecret).toBe(`enc:${res.secret}`);
  });

  it("rol kapısı: AVUKAT tanımlayamaz", async () => {
    const { svc } = build();
    await expect(svc.create({ ...admin, role: "AVUKAT" }, { url: "https://e.com", events: ["CASE_CREATE"] })).rejects.toThrow();
  });

  it("enqueueTest: WEBHOOK_TEST olaylı teslimat kuyruklar", async () => {
    const { svc, deliveries } = build();
    await svc.create(admin, { url: "https://example.com/h", events: ["CASE_CREATE"] });
    const r = await svc.enqueueTest(admin, "w1");
    expect(deliveries[0].event).toBe(WEBHOOK_TEST_EVENT);
    expect(JSON.parse(deliveries[0].payloadJson).id).toBe(r.deliveryId);
  });
});

describe("WebhooksService — fan-out", () => {
  it("katalog dışı eylem → 0; abone olmayan uç → 0; abone uç → teslimat (yük denetim alanlarını taşır)", async () => {
    const { svc, deliveries } = build();
    await svc.create(admin, { url: "https://a.com/h", events: ["CASE_CREATE"] });
    await svc.create(admin, { url: "https://b.com/h", events: ["HEARING_CREATE"] });
    expect(await svc.fanOut({ tenantId: "t1", action: "USER_LOGIN" })).toBe(0);
    expect(await svc.fanOut({ tenantId: "t2", action: "CASE_CREATE" })).toBe(0);
    expect(await svc.fanOut({ tenantId: "t1", userId: "u9", action: "CASE_CREATE", entity: "Case", entityId: "c1", detail: "2026/1" })).toBe(1);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].endpointId).toBe("w1");
    const payload = JSON.parse(deliveries[0].payloadJson);
    expect(payload).toMatchObject({ event: "CASE_CREATE", tenantId: "t1", entity: "Case", entityId: "c1", detail: "2026/1", actorUserId: "u9" });
    expect(payload.id).toBe(deliveries[0].id);
  });

  it("pasif uç fan-out almaz (önbellek güncelleme sonrası düşer)", async () => {
    const { svc, deliveries } = build();
    await svc.create(admin, { url: "https://a.com/h", events: ["CASE_CREATE"] });
    await svc.update(admin, "w1", { isActive: false });
    expect(await svc.fanOut({ tenantId: "t1", action: "CASE_CREATE" })).toBe(0);
    expect(deliveries).toHaveLength(0);
  });
});

describe("WebhooksService — dağıtım", () => {
  const now = new Date("2026-09-24T10:00:00Z");
  let ctx: ReturnType<typeof build>;
  beforeEach(async () => {
    ctx = build();
    await ctx.svc.create(admin, { url: "https://a.com/h", events: ["CASE_CREATE"] });
    await ctx.svc.fanOut({ tenantId: "t1", action: "CASE_CREATE", entityId: "c1" });
  });

  it("2xx → GONDERILDI; imza/başlıklar doğru", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200 })) as any;
    const r = await ctx.svc.dispatchDue(now, fetchImpl);
    expect(r).toEqual({ sent: 1, retried: 0, failed: 0 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://a.com/h");
    const secret = ctx.endpoints[0].encryptedSecret.replace(/^enc:/, "");
    expect(init.headers["x-nomosos-signature"]).toBe(signWebhookBody(secret, ctx.deliveries[0].payloadJson));
    expect(init.headers["x-nomosos-event"]).toBe("CASE_CREATE");
    expect(init.headers["x-nomosos-delivery"]).toBe(ctx.deliveries[0].id);
    expect(ctx.deliveries[0]).toMatchObject({ status: "GONDERILDI", attempts: 1, lastResponseCode: 200, deliveredAt: now });
  });

  it("500 → BEKLIYOR + 1 dk sonra; 5 yeniden denemeden sonra (6. deneme) BASARISIZ", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 500 })) as any;
    let r = await ctx.svc.dispatchDue(now, fetchImpl);
    expect(r).toEqual({ sent: 0, retried: 1, failed: 0 });
    expect(ctx.deliveries[0]).toMatchObject({ status: "BEKLIYOR", attempts: 1, lastResponseCode: 500, lastError: "HTTP 500" });
    expect(ctx.deliveries[0].nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
    // Vadesi gelmeden tekrar çağrı → hiçbir şey yapılmaz.
    expect(await ctx.svc.dispatchDue(now, fetchImpl)).toEqual({ sent: 0, retried: 0, failed: 0 });
    for (let i = 2; i <= 5; i++) {
      r = await ctx.svc.dispatchDue(new Date(ctx.deliveries[0].nextAttemptAt), fetchImpl);
      expect(r).toEqual({ sent: 0, retried: 1, failed: 0 });
      expect(ctx.deliveries[0].nextAttemptAt.getTime() - now.getTime()).toBeGreaterThan(0);
    }
    // 5 yeniden deneme tükendi: 12 saat sonra gelen 6. deneme de düşerse BASARISIZ.
    r = await ctx.svc.dispatchDue(new Date(ctx.deliveries[0].nextAttemptAt), fetchImpl);
    expect(r).toEqual({ sent: 0, retried: 0, failed: 1 });
    expect(ctx.deliveries[0]).toMatchObject({ status: "BASARISIZ", attempts: 6 });
  });

  it("ağ hatası → lastError mesajı, yeniden dener", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;
    await ctx.svc.dispatchDue(now, fetchImpl);
    expect(ctx.deliveries[0]).toMatchObject({ status: "BEKLIYOR", lastError: "ECONNREFUSED", lastResponseCode: null });
  });

  it("uç pasifse teslimat BASARISIZ/uç pasif ile kapanır, istek atılmaz", async () => {
    ctx.endpoints[0].isActive = false;
    const fetchImpl = vi.fn() as any;
    const r = await ctx.svc.dispatchDue(now, fetchImpl);
    expect(r.failed).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ctx.deliveries[0].lastError).toBe("uç pasif");
  });
});
