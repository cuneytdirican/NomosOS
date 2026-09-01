/**
 * D7 — vekalet ücreti API servis testleri (stub Prisma).
 */

import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { VekaletUcretiService } from "./vekalet-ucreti.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";

const TARIFE_ROW = {
  id: "t1",
  tenantId: "tenant-1",
  yil: 2026,
  maktuKademelerJson: JSON.stringify([
    { limitKurus: "20000000", ucretKurus: "3700000" },
    { limitKurus: "60000000", ucretKurus: "5000000" },
  ]),
  maktuTekrarJson: JSON.stringify({ esikKurus: "60000000", birimKurus: "10000000", ucretKurus: "300000" }),
  nispiOranYuzde: { toString: () => "16.50" } as unknown as PrismaDecimal,
  kdvOrani: { toString: () => "20" } as unknown as PrismaDecimal,
};

type PrismaDecimal = { toString(): string };

const USER = { tenantId: "tenant-1", userId: "u1", role: "ADMIN" } as never;

function serviceWith(row: unknown = TARIFE_ROW) {
  const audits: unknown[] = [];
  const prisma = {
    client: {
      vekaletTarife: {
        findUnique: async () => row,
        upsert: async (args: { create: Record<string, unknown> }) => ({ id: "t1", ...args.create }),
      },
    },
  } as unknown as PrismaService;
  const audit = { log: async (e: unknown) => { audits.push(e); } } as unknown as AuditService;
  return { svc: new VekaletUcretiService(prisma, audit), audits };
}

describe("Vekalet ücreti — hesap ucu", () => {
  it("tarife varsa hesap + görünür iz döner", async () => {
    const { svc } = serviceWith();
    const r = await svc.hesapla(USER, "100000000", 2026);
    expect(r.yil).toBe(2026);
    expect(r.rejim).toBe("NISPI"); // 1.000.000 TL'de nispi kazanır
    expect(r.onerilenBrutKurus).toBe("16500000");
    expect(r.iz.join(" ")).toContain("Kademe 1");
    expect(r.not).toContain("bilgilendirme");
  });

  it("tarife yoksa 404 + tarife giriş talimatı (rakam uydurulmaz)", async () => {
    const { svc } = serviceWith(null);
    await expect(svc.hesapla(USER, "1000000", 2026)).rejects.toThrow(NotFoundException);
  });
});

describe("Vekalet ücreti — tarife kaydetme", () => {
  it("upsert denetim izine yazılır", async () => {
    const { svc, audits } = serviceWith();
    const r = await svc.tarifeKaydet(USER as never, {
      yil: 2026,
      kademeler: [{ limitKurus: "20000000", ucretKurus: "3700000" }],
      tekrar: null,
      nispiOranYuzde: "16.50",
      kdvOrani: "20",
    });
    expect(r.yil).toBe(2026);
    expect(audits).toHaveLength(1);
  });

  it("boş kademe listesi reddedilir", async () => {
    const { svc } = serviceWith();
    await expect(
      svc.tarifeKaydet(USER as never, {
        yil: 2026,
        kademeler: [],
        tekrar: null,
        nispiOranYuzde: "16.50",
        kdvOrani: "20",
      }),
    ).rejects.toThrow();
  });
});
