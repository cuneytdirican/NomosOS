/**
 * PLATFORM MEVZUAT HAVUZU — YENİDEN ONAY VE SÜRÜM SINIRI TESTLERİ.
 *
 * Korunan taahhütler:
 *  1. importLegislation yeniden onayda mevcut künyeyi (RG tarihi/sayısı,
 *     numara, yıl, kaynak adresi) girdi boş geldi diye SİLMEZ.
 *  2. Dolu gelen değer mevcut değeri günceller.
 *  3. importStatute sürüm farkında RG künyesi yoksa sürüm sınırı NULL bırakılmaz:
 *     eski sürüm kapanır, yeni sürüm tespit tarihiyle açılır ve denetim izi
 *     bunun yaklaşık olduğunu söyler.
 */

import { describe, expect, it } from "vitest";
import { LegislationPoolService } from "./legislation-pool.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PlatformAuditService } from "../platform-audit.service";
import type { PlatformAuthUser } from "../platform.types";

const ACTOR: PlatformAuthUser = { id: "pu-1", role: "SUPER_ADMIN", ip: "127.0.0.1" } as PlatformAuthUser;

const EXISTING_LEGISLATION = {
  id: "lg-1",
  tenantId: null,
  docType: "YONETMELIK",
  title: "Eski Başlık",
  number: "2024/1",
  year: 2024,
  rgDate: new Date("2024-03-01T00:00:00Z"),
  rgNo: "32475",
  sourceKey: "RG_GUNLUK",
  sourceUrl: "https://www.resmigazete.gov.tr/eskiler/2024/03/20240301-1.htm",
  fullText: "ESKİ METİN ".repeat(20),
};

function legislationHarness(existing: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const creates: Array<Record<string, unknown>> = [];
  const audit: string[] = [];
  const client = {
    legislation: {
      findFirst: async () => existing,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { id: "lg-1", ...args.data };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        creates.push(args.data);
        return { id: "lg-2", ...args.data };
      },
    },
  };
  const svc = new LegislationPoolService(
    { client } as unknown as PrismaService,
    { log: async (e: { detail: string }) => void audit.push(e.detail) } as unknown as PlatformAuditService,
  );
  return { svc, updates, creates, audit };
}

describe("importLegislation — yeniden onayda alan koruması", () => {
  it("boş gelen künye alanları mevcut değeri KORUR", async () => {
    const h = legislationHarness(EXISTING_LEGISLATION);
    const res = await h.svc.importLegislation(ACTOR, {
      docType: "YONETMELIK",
      title: "Yeni Başlık",
      sourceKey: "RG_GUNLUK",
      sourceUrl: EXISTING_LEGISLATION.sourceUrl,
      // number/year/rgDate/rgNo/fullText YOK
    });
    expect(res.status).toBe("GUNCELLENDI");
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({
      title: "Yeni Başlık",
      number: "2024/1",
      year: 2024,
      rgNo: "32475",
      fullText: EXISTING_LEGISLATION.fullText,
    });
    expect((h.updates[0].rgDate as Date).toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });

  it("dolu gelen değer mevcut değeri günceller", async () => {
    const h = legislationHarness(EXISTING_LEGISLATION);
    await h.svc.importLegislation(ACTOR, {
      docType: "YONETMELIK",
      title: "Yeni Başlık",
      number: "2026/9",
      rgDate: "2026-09-04",
      rgNo: "33360",
      sourceKey: "RG_GUNLUK",
      sourceUrl: EXISTING_LEGISLATION.sourceUrl,
      fullText: "YENİ METİN ".repeat(20),
    });
    expect(h.updates[0]).toMatchObject({ number: "2026/9", rgNo: "33360" });
    expect((h.updates[0].rgDate as Date).toISOString()).toBe("2026-09-04T00:00:00.000Z");
    expect(String(h.updates[0].versionNote)).toContain("2026-09-04");
  });

  it("ilk girişte alanlar girdiden gelir; olmayanlar null", async () => {
    const h = legislationHarness(null);
    const res = await h.svc.importLegislation(ACTOR, {
      docType: "TEBLIG",
      title: "Bir Tebliğ",
      sourceKey: "RG_GUNLUK",
      sourceUrl: "https://www.resmigazete.gov.tr/eskiler/2026/09/20260904-5.htm",
    });
    expect(res.status).toBe("EKLENDI");
    expect(h.creates[0]).toMatchObject({ tenantId: null, number: null, year: null, rgDate: null, rgNo: null, authorityLevel: 10 });
  });
});

describe("importStatute — RG künyesi olmadan sürüm sınırı", () => {
  it("eski sürüm KAPANIR, yeni sürüm tespit tarihiyle açılır; denetim izi yaklaşıklığı söyler", async () => {
    const articleUpdates: Array<Record<string, unknown>> = [];
    const articleCreates: Array<Record<string, unknown>> = [];
    const audit: string[] = [];
    const existing = {
      id: "st-1",
      mevzuatNo: "4857",
      mevzuatTur: 1,
      title: "İŞ KANUNU",
      rgDate: null,
      rgNo: null,
      sourceUrl: null,
      articles: [{ id: "sav-1", articleNo: "25", versionSeq: 1, text: "Madde 25- eski metin", effectiveTo: null }],
    };
    const client = {
      statute: {
        findUnique: async () => existing,
        update: async () => ({}),
      },
      statuteArticleVersion: {
        update: async (args: { data: Record<string, unknown> }) => void articleUpdates.push(args.data),
        create: async (args: { data: Record<string, unknown> }) => void articleCreates.push(args.data),
      },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(client),
    };
    const svc = new LegislationPoolService(
      { client } as unknown as PrismaService,
      { log: async (e: { detail: string }) => void audit.push(e.detail) } as unknown as PlatformAuditService,
    );

    const res = await svc.importStatute(ACTOR, {
      mevzuatNo: "4857",
      mevzuatTur: 1,
      tertip: 5,
      title: "İŞ KANUNU",
      fullText: "İŞ KANUNU ".repeat(60),
      articles: [{ articleNo: "25", text: "Madde 25- YENİ metin" }],
      sourceKey: "MEVZUAT_GOV",
      // rgDate / changeRgDate YOK
    });

    expect(res.status).toBe("GUNCELLENDI");
    expect(articleUpdates).toHaveLength(1);
    expect(articleUpdates[0].effectiveTo).toBeInstanceOf(Date);
    expect(articleCreates).toHaveLength(1);
    expect(articleCreates[0].effectiveFrom).toBeInstanceOf(Date);
    // Sınır tarihi iki tarafta aynıdır: zincirde boşluk/çakışma yok.
    expect((articleCreates[0].effectiveFrom as Date).getTime()).toBe((articleUpdates[0].effectiveTo as Date).getTime());
    expect(audit.join("\n")).toContain("TESPİT tarihiyle");
  });
});
