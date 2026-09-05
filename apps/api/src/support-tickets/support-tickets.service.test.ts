/**
 * FAZ 8C — destek talebi + SLA.
 *  1. SLA hedefi önceliğe göre (KRITIK 2s / NORMAL 24s); yanıt gelmeden süre geçerse IHLAL, geç yanıt GEC.
 *  2. Kiracı detayı iç notları (internal) süzer; başka kiracının talebi 404.
 *  3. Kapatma: açan ya da ONAY rolü; SEKRETER başkasının talebini kapatamaz (403).
 */

import { describe, expect, it, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { supportDueAt, supportSla } from "@nomosos/shared";
import { SupportTicketsService } from "./support-tickets.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/types";

const AVUKAT = { userId: "u-av", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;
const SEKRETER = { userId: "u-sk", tenantId: "buro-A", role: "SEKRETER" } as AuthUser;
const PARTNER = { userId: "u-pt", tenantId: "buro-A", role: "PARTNER" } as AuthUser;
const YABANCI = { userId: "u-x", tenantId: "buro-B", role: "ADMIN" } as AuthUser;

function harness() {
  const tickets: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  const client = {
    user: { findUnique: vi.fn(async () => ({ fullName: "Av. Test" })) },
    supportTicket: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> & { messages?: { create: Record<string, unknown> } } }) => {
        const { messages: m, ...rest } = data;
        const t = { id: `t-${tickets.length + 1}`, status: "ACIK", firstResponseAt: null, resolvedAt: null, closedAt: null, createdAt: new Date(), ...rest };
        tickets.push(t);
        if (m) messages.push({ id: `m-${messages.length + 1}`, ticketId: t.id, internal: false, createdAt: new Date(), ...m.create });
        return t;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => tickets.find((t) => t.id === where.id && t.tenantId === where.tenantId) ?? null),
      findMany: vi.fn(async ({ where }: { where: { tenantId: string } }) => tickets.filter((t) => t.tenantId === where.tenantId)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const t = tickets.find((x) => x.id === where.id)!;
        Object.assign(t, data);
        return t;
      }),
    },
    supportTicketMessage: {
      findMany: vi.fn(async ({ where }: { where: { ticketId: string; internal?: boolean } }) => messages.filter((m) => m.ticketId === where.ticketId && (where.internal === undefined || m.internal === where.internal))),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const m = { id: `m-${messages.length + 1}`, internal: false, createdAt: new Date(), ...data };
        messages.push(m);
        return m;
      }),
    },
  };
  return { svc: new SupportTicketsService({ client } as unknown as PrismaService), tickets, messages };
}

describe("Faz 8C: SLA hesabı", () => {
  it("öncelik → hedef; bekleyen/ihlal/zamanında/geç", () => {
    const t0 = new Date("2026-09-01T09:00:00Z");
    expect(supportDueAt("KRITIK", t0).toISOString()).toBe("2026-09-01T11:00:00.000Z");
    expect(supportDueAt("NORMAL", t0).toISOString()).toBe("2026-09-02T09:00:00.000Z");
    const due = supportDueAt("YUKSEK", t0);
    expect(supportSla({ firstResponseDueAt: due, firstResponseAt: null }, new Date("2026-09-01T10:00:00Z"))).toMatchObject({ state: "BEKLIYOR", remainingMinutes: 420 });
    expect(supportSla({ firstResponseDueAt: due, firstResponseAt: null }, new Date("2026-09-01T18:00:00Z"))).toMatchObject({ state: "IHLAL", remainingMinutes: -60 });
    expect(supportSla({ firstResponseDueAt: due, firstResponseAt: new Date("2026-09-01T12:00:00Z") })).toMatchObject({ state: "ZAMANINDA", remainingMinutes: null });
    expect(supportSla({ firstResponseDueAt: due, firstResponseAt: new Date("2026-09-01T20:00:00Z") })).toMatchObject({ state: "GEC" });
  });
});

describe("Faz 8C: SupportTicketsService", () => {
  it("talep açar; iç not kiracıya dönmez; başka kiracı 404", async () => {
    const h = harness();
    const t = await h.svc.create(AVUKAT, { subject: "UYAP eklentisi bağlanmıyor", body: "Popup 'oturum yok' diyor.", category: "UYAP", priority: "YUKSEK" });
    expect(t.sla.state).toBe("BEKLIYOR");
    expect(h.messages[0]).toMatchObject({ authorKind: "KIRACI", authorName: "Av. Test" });
    h.messages.push({ id: "m-int", ticketId: t.id, internal: true, authorKind: "PLATFORM", body: "iç not", createdAt: new Date() });
    const d = await h.svc.detail(AVUKAT, t.id);
    expect(d.messages).toHaveLength(1);
    await expect(h.svc.detail(YABANCI, t.id)).rejects.toBeInstanceOf(NotFoundException);
    const listed = await h.svc.list(AVUKAT);
    expect(listed.acik).toBe(1);
  });

  it("kapatma yetkisi: açan ya da ONAY; sekreter 403; kapalıya mesaj 400", async () => {
    const h = harness();
    const t = await h.svc.create(AVUKAT, { subject: "Fatura sorusu", body: "KDV oranı?", category: "FATURA", priority: "NORMAL" });
    await expect(h.svc.close(SEKRETER, t.id)).rejects.toBeInstanceOf(ForbiddenException);
    const closed = await h.svc.close(PARTNER, t.id);
    expect(closed.status).toBe("KAPALI");
    await expect(h.svc.addMessage(AVUKAT, t.id, { body: "tekrar" })).rejects.toThrow(/Kapalı/);
  });
});
