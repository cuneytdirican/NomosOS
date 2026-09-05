import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { MailService } from "../../mail/mail.service";
import type { NotificationOutboxService } from "../notification-outbox.service";
import type { PushProvider } from "../push/push-provider";
import { BildirimDagitimiJob } from "./bildirim-dagitimi.job";
import { BildirimTemizligiJob, GENEL_SAKLAMA_GUN, OKUNMUS_SAKLAMA_GUN } from "./bildirim-temizligi.job";

const NOW = new Date("2026-09-25T10:00:00Z");

function build(opts: { mailConfigured?: boolean; pushConfigured?: boolean; prefs?: { inApp: boolean; email: boolean; push: boolean } } = {}) {
  const rows = [
    { id: "n1", tenantId: "t1", userId: "u1", kind: "DURUSMA_YARIN", title: "Yarın duruşma", body: "Ankara 3. AHM 10:00", resourceType: "Hearing", resourceId: "h1" },
    { id: "n2", tenantId: "t1", userId: "u2", kind: "SURE_YAKLASIYOR", title: "Süre", body: "İstinaf 2 gün", resourceType: "Deadline", resourceId: "d1" },
  ];
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const deactivated: string[][] = [];
  const prisma = {
    client: {
      notificationOutbox: {
        findMany: vi.fn(async () => rows),
        update: vi.fn(async (a: { where: unknown; data: Record<string, unknown> }) => { updates.push(a); return {}; }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === "u1" ? { email: "u1@b.tr", fullName: "U1", isActive: true } : { email: "u2@b.tr", fullName: "U2", isActive: false }),
      },
      deviceToken: {
        findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
          where.userId === "u1" ? [{ token: "ExponentPushToken[a]", platform: "IOS" }] : []),
        updateMany: vi.fn(async ({ where }: { where: { token: { in: string[] } } }) => { deactivated.push(where.token.in); return { count: 1 }; }),
      },
    },
  } as unknown as PrismaService;
  const mailSend = vi.fn(async () => ({ sent: true, messageId: "<m>" }));
  const mail = { configured: opts.mailConfigured ?? true, send: mailSend } as unknown as MailService;
  const outbox = { preferredChannels: vi.fn(async () => opts.prefs ?? { inApp: true, email: true, push: true }) } as unknown as NotificationOutboxService;
  const pushSend = vi.fn(async () => ({ delivered: 1, skipped: 0, reason: "ok" }));
  const push = { name: "expo", configured: opts.pushConfigured ?? true, send: pushSend, invalidTokens: ["ExponentPushToken[dead]"] } as unknown as PushProvider;
  return { job: new BildirimDagitimiJob(prisma, mail, outbox, push), mailSend, pushSend, updates, deactivated, prisma };
}

describe("BildirimDagitimiJob", () => {
  it("e-posta aktif kullanıcıya gider, pasif kullanıcıya gitmez; push jetonu olana gider; her satır bir kez damgalanır", async () => {
    const b = build();
    const r = await b.job.run({ trigger: "CRON", now: NOW } as never);
    expect(b.mailSend).toHaveBeenCalledTimes(1);
    expect(b.mailSend).toHaveBeenCalledWith(expect.objectContaining({ to: "u1@b.tr", subject: "NomosOS — Yarın duruşma" }));
    expect(b.pushSend).toHaveBeenCalledTimes(1);
    expect(b.updates.map((u) => u.data.dispatchedAt)).toEqual([NOW, NOW]);
    expect(b.updates[0].data.sentAt).toBe(NOW);
    expect(b.updates[1].data.sentAt).toBeUndefined();
    expect(r.detail).toMatchObject({ islenen: 2, eposta: 1, push: 1, smtpTanimli: true, pushSaglayici: "expo" });
    expect(r.skipped).toBe(1);
    // DeviceNotRegistered → jeton pasifleştirildi
    expect(b.deactivated).toEqual([["ExponentPushToken[dead]"]]);
  });

  it("tercih kapalıysa kanal kullanılmaz; sağlayıcı yoksa yine damgalanır (tekrar denenmez)", async () => {
    const b = build({ prefs: { inApp: true, email: false, push: false } });
    const r = await b.job.run({ trigger: "CRON", now: NOW } as never);
    expect(b.mailSend).not.toHaveBeenCalled();
    expect(b.pushSend).not.toHaveBeenCalled();
    expect(b.updates).toHaveLength(2);
    expect(r.skipped).toBe(2);

    const c = build({ mailConfigured: false, pushConfigured: false });
    const r2 = await c.job.run({ trigger: "CRON", now: NOW } as never);
    expect(c.mailSend).not.toHaveBeenCalled();
    expect(r2.detail).toMatchObject({ smtpTanimli: false, pushSaglayici: "yok" });
    expect(c.updates).toHaveLength(2);
  });

  it("sorgu: dispatchedAt null + zamanı gelmiş + kullanıcılı satırlar", async () => {
    const b = build();
    await b.job.run({ trigger: "CRON", now: NOW } as never);
    const arg = (b.prisma.client.notificationOutbox.findMany as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { where: Record<string, unknown>; take: number };
    expect(arg.where.dispatchedAt).toBeNull();
    expect(arg.where.userId).toEqual({ not: null });
    expect(arg.take).toBe(200);
  });
});

describe("BildirimTemizligiJob", () => {
  it("okunmuş/iptal 90 gün, geri kalan 180 gün", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const prisma = { client: { notificationOutbox: { deleteMany: vi.fn(async (a: { where: Record<string, unknown> }) => { calls.push(a.where); return { count: 3 }; }) } } } as unknown as PrismaService;
    const r = await new BildirimTemizligiJob(prisma).run({ trigger: "CRON", now: NOW } as never);
    expect(r.detail).toEqual({ okunmusSilinen: 3, eskiSilinen: 3 });
    expect(calls[0]).toMatchObject({ status: { in: ["OKUNDU", "IPTAL"] } });
    expect((calls[0].createdAt as { lt: Date }).lt.getTime()).toBe(NOW.getTime() - OKUNMUS_SAKLAMA_GUN * 86_400_000);
    expect((calls[1].createdAt as { lt: Date }).lt.getTime()).toBe(NOW.getTime() - GENEL_SAKLAMA_GUN * 86_400_000);
  });
});
