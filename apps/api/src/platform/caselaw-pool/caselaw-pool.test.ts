/**
 * İÇTİHAT HAVUZ YÖNETİMİ TESTLERİ (ai-egitim-stratejisi.md D1).
 *
 * Korunan taahhütler:
 *  1. Biçimsiz künye havuza GİREMEZ (şema reddeder) — halüsinasyon zinciri
 *     havuz girişinde kesilir.
 *  2. Makul olmayan karar tarihi (1900 öncesi / gelecek yıl sonrası) reddedilir.
 *  3. Aynı partide aynı künye ikinci kaydı REDDEDİLİR.
 *  4. Büronun manuel kaydı (createdByTenantId != null) EZİLMEZ — ATLANIR.
 *  5. Yeni künye EKLENİR; mevcut sistem kaydı GÜNCELLENİR.
 *  6. İçe aktarım denetim izine düşer.
 */

import { describe, expect, it } from "vitest";
import { CaselawPoolService } from "./caselaw-pool.service";
import {
  isPlausibleDecisionDate,
  poolImportSchema,
  poolRecordSchema,
} from "./caselaw-pool.schemas";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PlatformAuditService } from "../platform-audit.service";
import type { PlatformAuthUser } from "../platform.types";

const ACTOR: PlatformAuthUser = { id: "pu-1", role: "SUPER_ADMIN", ip: "127.0.0.1" } as PlatformAuthUser;

interface PoolHarness {
  svc: CaselawPoolService;
  auditLines: string[];
  existing: Record<string, unknown> | null;
  upserts: Record<string, unknown>[];
}

function serviceWith(existing: Record<string, unknown> | null = null): PoolHarness {
  const auditLines: string[] = [];
  const upserts: Record<string, unknown>[] = [];
  const prisma = {
    client: {
      caseLawDocument: {
        findUnique: async () => existing,
        upsert: async (args: { create: Record<string, unknown> }) => {
          upserts.push(args.create);
          return { id: "cl-1", ...args.create };
        },
      },
    },
  } as unknown as PrismaService;
  const audit = { log: async (e: { detail: string }) => { auditLines.push(e.detail); } } as unknown as PlatformAuditService;
  return { svc: new CaselawPoolService(prisma, audit), auditLines, existing, upserts };
}

const RECORD = {
  court: "Yargıtay 9. Hukuk Dairesi",
  caseNumber: "2016/1234",
  decisionNumber: "2017/5678",
  decisionDate: "2017-06-15",
};

describe("Havuz şema doğrulaması", () => {
  it("geçerli künye kabul edilir", () => {
    expect(poolRecordSchema.safeParse(RECORD).success).toBe(true);
  });

  it("esas no harf taşıyorsa reddedilir", () => {
    const res = poolRecordSchema.safeParse({ ...RECORD, caseNumber: "2016/1234 E." });
    expect(res.success).toBe(false);
  });

  it("boş/çok kısa mahkeme adı reddedilir", () => {
    const res = poolRecordSchema.safeParse({ ...RECORD, court: "  " });
    expect(res.success).toBe(false);
  });

  it("kaynak etiketi yalnız BÜYÜK harf/rakam/alt çizgi olabilir", () => {
    const base = { sourceAdapter: "PLATFORM_ICAKTARIM", records: [RECORD] };
    expect(poolImportSchema.safeParse(base).success).toBe(true);
    expect(poolImportSchema.safeParse({ ...base, sourceAdapter: "lexpera-dosya" }).success).toBe(false);
  });

  it("500 kayıttan fazlası reddedilir (parti sınırı)", () => {
    const records = Array.from({ length: 501 }, () => RECORD);
    expect(poolImportSchema.safeParse({ sourceAdapter: "X", records }).success).toBe(false);
  });
});

describe("Karar tarihi aralığı", () => {
  it("1899 reddedilir, 1990 kabul edilir, gelecek yıl+2 reddedilir", () => {
    expect(isPlausibleDecisionDate("1899-01-01")).toBe(false);
    expect(isPlausibleDecisionDate("1990-05-05")).toBe(true);
    const future = new Date().getFullYear() + 2;
    expect(isPlausibleDecisionDate(`${future}-01-01`)).toBe(false);
  });
});

describe("Toplu içe aktarım", () => {
  it("yeni künye EKLENİR ve denetim izine düşer", async () => {
    const { svc, auditLines, upserts } = serviceWith(null);
    const res = await svc.importRecords(ACTOR, {
      sourceAdapter: "PLATFORM_ICAKTARIM",
      records: [RECORD],
    });
    expect(res.results[0].status).toBe("EKLENDI");
    expect(res.counts).toEqual({ added: 1, updated: 0, skipped: 0, rejected: 0, total: 1 });
    expect(upserts[0]).toMatchObject({ sourceAdapter: "PLATFORM_ICAKTARIM", createdByTenantId: null });
    expect(auditLines[0]).toContain("1 eklendi");
  });

  it("mevcut sistem kaydı GUNCELLENIR (tekrar içe aktarım idempotent)", async () => {
    const { svc } = serviceWith({ id: "cl-9", createdByTenantId: null });
    const res = await svc.importRecords(ACTOR, { sourceAdapter: "X", records: [RECORD] });
    expect(res.results[0].status).toBe("GUNCELLENDI");
    expect(res.counts.updated).toBe(1);
  });

  it("büronun manuel kaydı EZİLMEZ — ATLANIR", async () => {
    const { svc, upserts } = serviceWith({ id: "cl-7", createdByTenantId: "tenant-a" });
    const res = await svc.importRecords(ACTOR, { sourceAdapter: "X", records: [RECORD] });
    expect(res.results[0].status).toBe("ATLANDI");
    expect(upserts).toHaveLength(0);
  });

  it("aynı partide aynı künye ikinci kez REDDEDİLİR", async () => {
    const { svc } = serviceWith(null);
    const res = await svc.importRecords(ACTOR, {
      sourceAdapter: "X",
      records: [RECORD, RECORD],
    });
    expect(res.results[0].status).toBe("EKLENDI");
    expect(res.results[1].status).toBe("REDDEDILDI");
    expect(res.counts).toMatchObject({ added: 1, rejected: 1 });
  });

  it("makul olmayan tarih REDDEDİLİR (upsert çağrılmaz)", async () => {
    const { svc, upserts } = serviceWith(null);
    const res = await svc.importRecords(ACTOR, {
      sourceAdapter: "X",
      records: [{ ...RECORD, decisionDate: "1850-01-01" }],
    });
    expect(res.results[0].status).toBe("REDDEDILDI");
    expect(upserts).toHaveLength(0);
  });

  it("tek kaydın hatası partiyi düşürmez — öteki kayıtlar işlenir", async () => {
    const { svc } = serviceWith(null);
    const res = await svc.importRecords(ACTOR, {
      sourceAdapter: "X",
      records: [RECORD, { ...RECORD, court: "Danıştay 10. Daire", caseNumber: "2018/99" }],
    });
    expect(res.counts).toMatchObject({ added: 2, rejected: 0 });
  });
});
