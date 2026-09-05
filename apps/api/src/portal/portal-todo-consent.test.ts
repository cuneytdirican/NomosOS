/**
 * FAZ 7F — portal yapılacaklar + rıza kayıtları.
 *
 * Todo: yayınlanmamış dosyaya bağlı istek müvekkile GÖRÜNMEZ; başka müvekkilin isteği tamamlanamaz;
 *       kapanmış istek yeniden kapanmaz; iptal büro yetkisi.
 * Rıza: metin sürümü uyuşmazsa 400; aydınlatma geri çekilemez; kayıt ekleme-yalnız (son satır günceldir);
 *       yanıt parola/IP sızdırmaz (müvekkil görünümü), büro geçmişi IP/cihaz izi taşır.
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PortalTodoService } from "./portal-todo.service";
import { PORTAL_CONSENT_TEXTS, PortalConsentService, consentTextHash } from "./portal-consent.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { PortalPublicationService } from "./portal-publication.service";
import type { AuthUser } from "../common/types";
import type { PortalAuthUser } from "./portal.types";

const OFFICE = { userId: "u-av", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;
const CLIENT = { portalUserId: "pu-1", tenantId: "buro-A", clientId: "cl-1", email: "m@x.tr", fullName: "Müvekkil Bir" } as PortalAuthUser;

function todoHarness(visibleCases: string[] = ["case-pub"]) {
  const rows: Record<string, unknown>[] = [];
  const client = {
    client: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === "cl-1" ? { id: "cl-1" } : null)) },
    case: { findFirst: vi.fn(async ({ where }: { where: { id: string; clientId: string } }) => (["case-pub", "case-hidden"].includes(where.id) && where.clientId === "cl-1" ? { id: where.id } : null)) },
    portalTodo: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `t-${rows.length + 1}`, status: "ACIK", completedAt: null, completedNote: null, createdAt: new Date(), case: null, ...data };
        rows.push(r);
        return r;
      }),
      findMany: vi.fn(async ({ where }: { where: { clientId?: string } }) => rows.filter((r) => !where.clientId || r.clientId === where.clientId)),
      findFirst: vi.fn(async ({ where }: { where: { id: string; clientId?: string; tenantId: string } }) => rows.find((r) => r.id === where.id && (!where.clientId || r.clientId === where.clientId)) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      }),
    },
  };
  const publications = { visibleCaseIds: vi.fn(async () => visibleCases) };
  const svc = new PortalTodoService({ client } as unknown as PrismaService, { log: vi.fn(async () => undefined) } as unknown as AuditService, publications as unknown as PortalPublicationService);
  return { svc, rows };
}

describe("Faz 7F: PortalTodo", () => {
  it("yayınlanmamış dosyaya bağlı istek müvekkile görünmez; dosyasız ve yayında olan görünür", async () => {
    const h = todoHarness(["case-pub"]);
    await h.svc.create(OFFICE, { clientId: "cl-1", caseId: "case-pub", title: "Kira sözleşmesi" });
    await h.svc.create(OFFICE, { clientId: "cl-1", caseId: "case-hidden", title: "Gizli dosya belgesi" });
    await h.svc.create(OFFICE, { clientId: "cl-1", caseId: null, title: "Kimlik fotokopisi" });
    const list = await h.svc.listForClient(CLIENT);
    expect(list.items.map((i) => i.title)).toEqual(["Kira sözleşmesi", "Kimlik fotokopisi"]);
  });

  it("tamamlama: not yazılır, ikinci kez kapanmaz, başka müvekkil 404", async () => {
    const h = todoHarness();
    const created = await h.svc.create(OFFICE, { clientId: "cl-1", title: "İmzalı vekâlet" });
    const done = await h.svc.complete(CLIENT, created.id, { note: "Portaldan yükledim" });
    expect(done).toMatchObject({ status: "TAMAMLANDI", completedNote: "Portaldan yükledim" });
    await expect(h.svc.complete(CLIENT, created.id, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.svc.complete({ ...CLIENT, clientId: "cl-2" }, created.id, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it("büro: başka müvekkile ait dosya ile istek açılamaz", async () => {
    const h = todoHarness();
    await expect(h.svc.create(OFFICE, { clientId: "cl-1", caseId: "case-yok", title: "x-y-z" })).rejects.toBeInstanceOf(NotFoundException);
  });
});

function consentHarness() {
  const rows: Record<string, unknown>[] = [];
  const client = {
    portalConsent: {
      findMany: vi.fn(async () => [...rows].reverse().map((r) => ({ ...r, portalUser: { email: "m@x.tr", fullName: "Müvekkil Bir" } }))),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `c-${rows.length + 1}`, createdAt: new Date(Date.now() + rows.length), ...data };
        rows.push(r);
        return r;
      }),
    },
  };
  return { svc: new PortalConsentService({ client } as unknown as PrismaService), rows };
}

describe("Faz 7F: PortalConsent", () => {
  it("başlangıç: aydınlatma eksik; kabul sonrası tamam; geri çekme yalnız çekilebilir türlerde", async () => {
    const h = consentHarness();
    const before = await h.svc.status(CLIENT);
    expect(before.missingRequired).toEqual(["KVKK_AYDINLATMA"]);
    const after = await h.svc.decide(CLIENT, { kind: "KVKK_AYDINLATMA", version: "v1", accepted: true }, { ip: "10.0.0.1", userAgent: "UA" });
    expect(after.missingRequired).toEqual([]);
    await expect(h.svc.decide(CLIENT, { kind: "KVKK_AYDINLATMA", version: "v1", accepted: false }, { ip: null, userAgent: null })).rejects.toBeInstanceOf(BadRequestException);
    await h.svc.decide(CLIENT, { kind: "ILETISIM_SMS", version: "v1", accepted: true }, { ip: null, userAgent: null });
    const withdrawn = await h.svc.decide(CLIENT, { kind: "ILETISIM_SMS", version: "v1", accepted: false }, { ip: null, userAgent: null });
    expect(withdrawn.items.find((i) => i.kind === "ILETISIM_SMS")?.accepted).toBe(false);
    // ekleme-yalnız: 4 satır (kabul, sms kabul, sms geri çekme = 3 başarılı yazım)
    expect(h.rows).toHaveLength(3);
    expect(h.rows[0]).toMatchObject({ textHash: consentTextHash("KVKK_AYDINLATMA", "v1", PORTAL_CONSENT_TEXTS[0].text), ip: "10.0.0.1" });
  });

  it("sürüm uyuşmazlığı 400; büro geçmişi IP/cihaz izi taşır", async () => {
    const h = consentHarness();
    await expect(h.svc.decide(CLIENT, { kind: "ACIK_RIZA", version: "v0", accepted: true }, { ip: null, userAgent: null })).rejects.toBeInstanceOf(BadRequestException);
    await h.svc.decide(CLIENT, { kind: "ACIK_RIZA", version: "v1", accepted: true }, { ip: "1.2.3.4", userAgent: "Chrome" });
    const office = await h.svc.historyForOffice(OFFICE, "cl-1");
    expect(office.current.find((c) => c.kind === "ACIK_RIZA")?.accepted).toBe(true);
    expect(office.history[0]).toMatchObject({ kind: "ACIK_RIZA", accepted: true, ip: "1.2.3.4", email: "m@x.tr" });
  });
});
