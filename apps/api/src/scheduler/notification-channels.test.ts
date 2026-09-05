/** Faz 1: bildirim kanal tercihleri tek yerden okunur; kayıt yoksa hepsi açık (fail-open). */
import { describe, expect, it, vi } from "vitest";
import { NotificationOutboxService } from "./notification-outbox.service";

function build(pref: Record<string, boolean> | null) {
  const prisma = { client: { notificationPreference: { findUnique: vi.fn(async () => pref) }, notificationOutbox: { create: vi.fn(async () => ({})) } } };
  return { svc: new NotificationOutboxService(prisma as any), prisma };
}

describe("preferredChannels", () => {
  it("kayıt yok → inApp/email/push açık", async () => {
    const { svc } = build(null);
    expect(await svc.preferredChannels("t1", "u1", "SURE_YAKLASIYOR" as any)).toEqual({ inApp: true, email: true, push: true });
  });
  it("kayıt varsa alanlar okunur (email kapalı, push açık)", async () => {
    const { svc } = build({ inApp: true, email: false, push: true });
    expect(await svc.preferredChannels("t1", "u1", "DURUSMA_YARIN" as any)).toEqual({ inApp: true, email: false, push: true });
  });
  it("inApp kapalıysa giden kutusuna yazılmaz (atlandi)", async () => {
    const { svc, prisma } = build({ inApp: false, email: true, push: true });
    const r = await svc.enqueue({ tenantId: "t1", userId: "u1", kind: "SURE_YAKLASIYOR" as any, title: "t", body: "b", dedupeKey: "k" });
    expect(r).toBe("atlandi");
    expect(prisma.client.notificationOutbox.create).not.toHaveBeenCalled();
  });
});
