/**
 * BİLDİRİM TERCİHLERİ (Enterprise++) — giden kutusu tercihe uyar.
 *
 *  1. Tercih kaydı yoksa → yazılır (varsayılan açık; süre uyarısı kaybolmaz).
 *  2. inApp=false → giden kutusuna YAZILMAZ ("atlandi").
 *  3. Tercih tablosu okunamazsa (eski sahte prisma / hata) → varsayılan uygulanır, iş DURMAZ.
 *  4. getPreferences tüm türleri döner; setPreferences geçersiz türü reddeder.
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { NotificationOutboxService } from "./notification-outbox.service";
import { NotificationsService } from "./notifications.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/types";

const USER = { userId: "u-1", tenantId: "t-1", role: "AVUKAT" } as AuthUser;

function outboxHarness(pref: { inApp: boolean } | null | "throw") {
  const created: unknown[] = [];
  const client: Record<string, unknown> = {
    notificationOutbox: { create: vi.fn(async ({ data }: { data: unknown }) => void created.push(data)) },
  };
  if (pref !== "throw") {
    client.notificationPreference = { findUnique: vi.fn(async () => pref) };
  }
  return { svc: new NotificationOutboxService({ client } as unknown as PrismaService), created };
}

const ENTRY = {
  tenantId: "t-1",
  userId: "u-1",
  kind: "SURE_YAKLASIYOR" as const,
  title: "3 gün kaldı",
  body: "İstinaf süresi",
  dedupeKey: "deadline:d-1:3g",
};

describe("NotificationOutboxService.enqueue — tercih kapısı", () => {
  it("tercih yoksa yazılır", async () => {
    const h = outboxHarness(null);
    expect(await h.svc.enqueue(ENTRY)).toBe("yazildi");
    expect(h.created).toHaveLength(1);
  });

  it("inApp=false → atlanır, giden kutusuna yazılmaz", async () => {
    const h = outboxHarness({ inApp: false });
    expect(await h.svc.enqueue(ENTRY)).toBe("atlandi");
    expect(h.created).toHaveLength(0);
  });

  it("tercih tablosu okunamazsa varsayılan (açık) uygulanır — iş durmaz", async () => {
    const h = outboxHarness("throw");
    expect(await h.svc.enqueue(ENTRY)).toBe("yazildi");
  });
});

describe("NotificationsService — tercihler", () => {
  function svc(rows: Array<{ kind: string; inApp: boolean; email: boolean; push: boolean }>) {
    const upserts: unknown[] = [];
    const client = {
      notificationPreference: {
        findMany: vi.fn(async () => rows),
        upsert: vi.fn(async (args: { create: unknown }) => void upserts.push(args.create)),
      },
    };
    return { svc: new NotificationsService({ client } as unknown as PrismaService), upserts };
  }

  it("tüm türler döner; kayıt olmayan tür varsayılan açık", async () => {
    const { svc: s } = svc([{ kind: "SURE_GECTI", inApp: false, email: true, push: true }]);
    const res = await s.getPreferences(USER);
    expect(res.items.length).toBeGreaterThanOrEqual(9);
    expect(res.items.find((i) => i.kind === "SURE_GECTI")?.inApp).toBe(false);
    expect(res.items.find((i) => i.kind === "SURE_YAKLASIYOR")?.inApp).toBe(true);
    expect(res.channels.inApp).toBe(true);
  });

  it("geçersiz tür reddedilir; geçerli tür upsert edilir (kiracı + kullanıcı anahtarlı)", async () => {
    const { svc: s, upserts } = svc([]);
    await expect(
      s.setPreferences(USER, [{ kind: "YOK_BOYLE" as never, inApp: true, email: true, push: true }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await s.setPreferences(USER, [{ kind: "DURUSMA_YARIN", inApp: true, email: false, push: true }]);
    expect(upserts[0]).toMatchObject({ tenantId: "t-1", userId: "u-1", kind: "DURUSMA_YARIN", email: false });
  });
});
