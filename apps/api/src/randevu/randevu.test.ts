/**
 * E9 — RANDEVU testleri (rakip analizi).
 *
 * Korunan taahhütler:
 *  1. Çakışma kapısı: aynı büroda KESİŞEN iki randevu kurulamaz (409);
 *     art arda (10:00-10:30, 10:30-11:00) kurulabilmelidir.
 *  2. Portal self-servisi: süre sabit 30 dk; geçmiş zamana randevu yok;
 *     clientId İSTEMCİDEN ALINMAZ — portal oturumundan gelir.
 *  3. Portal iptal: yalnız kendi PLANLANDI randevusu.
 *  4. Büro durum değişimi OPERASYON rolü ister.
 */

import { describe, expect, it } from "vitest";
import { ConflictException } from "@nestjs/common";
import { RandevuService } from "./randevu.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";

const TENANT = "t-1";
const BUREAU_USER = { tenantId: TENANT, userId: "u-1", role: "SEKRETER" } as never;
const PORTAL_USER = {
  portalUserId: "p-1",
  tenantId: TENANT,
  clientId: "c-1",
  email: "m@x.test",
  fullName: "Müvekkil",
  clientName: "Müvekkil",
  ip: "1.1.1.1",
} as never;

function serviceWith(over?: { cakisan?: unknown }) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    client: {
      randevu: {
        findFirst: async () => over?.cakisan ?? null,
        findMany: async () => [],
        count: async () => 0,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "r-1", status: "PLANLANDI", ...data };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => ({ id: "r-1", ...data }),
      },
    },
  } as unknown as PrismaService;
  const audit = { log: async () => {} } as unknown as AuditService;
  return { svc: new RandevuService(prisma, audit), created };
}

// BUGÜN SABİT DEĞİL — NİSPİ: testin koştuğu AN'dan 1 saat sonra (zaman-bombası
// test olmasın: sabit tarih yazıldığı günün sonunda "geçmiş zamana randevu"
// hatasına düşüyordu).
const BUGUN = new Date(Date.now() + 60 * 60_000);
const at = (minutesOffset: number) => new Date(BUGUN.getTime() + minutesOffset * 60_000);

describe("Çakışma kapısı", () => {
  it("boş ajandaya randevu kurulur", async () => {
    const { svc, created } = serviceWith();
    const r = await svc.create(BUREAU_USER, {
      title: "Müvekkil görüşmesi",
      startAt: BUGUN,
      endAt: at(30),
    });
    expect(r.status).toBe("PLANLANDI");
    expect(created[0].title).toBe("Müvekkil görüşmesi");
  });

  it("kesişen randevu reddedilir (409)", async () => {
    const { svc } = serviceWith({ cakisan: { id: "diger" } });
    await expect(
      svc.create(BUREAU_USER, {
        title: "Çakışan randevu",
        startAt: at(15),
        endAt: at(45),
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("bitişi başlangıca değen randevu KABUL edilir (yarı-açık aralık)", async () => {
    const { svc } = serviceWith(); // cakisan yok — BUGUN+30..+60 serbest
    const r = await svc.create(BUREAU_USER, {
      title: "Art arda randevu",
      startAt: at(30),
      endAt: at(60),
    });
    expect(r.status).toBe("PLANLANDI");
  });

  it("bitiş başlangıçtan önce reddedilir", async () => {
    const { svc } = serviceWith();
    await expect(
      svc.create(BUREAU_USER, {
        title: "Ters aralık",
        startAt: at(60),
        endAt: at(0),
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe("Portal self-servisi", () => {
  it("süre sabit 30 dakikadır ve clientId oturumdan gelir", async () => {
    const { svc, created } = serviceWith();
    const r = await svc.portalCreate(PORTAL_USER, {
      title: "Büroda görüşme",
      startAt: BUGUN,
    });
    expect(r.endAt.getTime() - r.startAt.getTime()).toBe(30 * 60_000);
    expect(created[0].clientId).toBe("c-1"); // istemciden DEĞİL oturumdan
    expect(created[0].portalUserId).toBe("p-1");
  });

  it("geçmiş zamana randevu alınamaz", async () => {
    const { svc } = serviceWith();
    await expect(
      svc.portalCreate(PORTAL_USER, {
        title: "Geçmiş",
        startAt: new Date(Date.now() - 3_600_000),
      }),
    ).rejects.toThrow(/Geçmiş/);
  });
});

describe("Kaynak taahhüdü — portal uçları kayıtlı", () => {
  it("portal controller'da randevu uçları ve hız sınırı var", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(`${process.cwd()}/src/portal/portal.controller.ts`, "utf-8");
    expect(src).toContain('@Get("randevular")');
    expect(src).toContain('@Post("randevular")');
    expect(src).toContain('@Post("randevular/:id/iptal")');
    expect(src).toContain('bucket: "portal-randevu"');
  });

  it("büro uçları /randevular üzerinde; durum kapısı serviste (rol)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(`${process.cwd()}/src/randevu/randevu.controller.ts`, "utf-8");
    expect(src).toContain('@Controller("randevular")');
    const service = fs.readFileSync(`${process.cwd()}/src/randevu/randevu.service.ts`, "utf-8");
    expect(service).toContain("assertRole(user, ROLE_SETS.OPERASYON");
  });
});
