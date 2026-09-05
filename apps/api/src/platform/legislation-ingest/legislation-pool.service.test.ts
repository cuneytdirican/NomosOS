/**
 * PLATFORM MEVZUAT HAVUZU TESTLERİ (LegislationPoolService).
 *
 * Korunan taahhütler:
 *  1. Biçimsiz kanun kaydı REDDEDİLİR (kuyruğa da giremez).
 *  2. İlk giriş: kanun + tüm maddeler sürüm 1 olarak girer.
 *  3. Aynı metin ikinci kez işlenmez (ATLANDI).
 *  4. Değişiklik eski madde metnini EZMEZ: eski sürüm effectiveTo ile kapanır,
 *     yeni sürüm versionSeq+1 ile açılır (sürüm zinciri).
 *  5. Kaldırılan madde kapatılır, metin silinmez.
 *  6. Kanun dışı belge Legislation platform kaydı olarak girer (tenantId=null).
 */

import { describe, expect, it } from "vitest";
import { LegislationPoolService } from "./legislation-pool.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PlatformAuditService } from "../platform-audit.service";
import type { PlatformAuthUser } from "../platform.types";
import type { ParsedStatuteArticle } from "@nomosos/legal-core";

const ACTOR: PlatformAuthUser = { id: "pu-1", role: "SUPER_ADMIN", ip: "127.0.0.1" } as PlatformAuthUser;

const BASE_INPUT = {
  mevzuatNo: "4857",
  mevzuatTur: 1,
  tertip: 5,
  title: "İŞ KANUNU",
  abbrs: "İşK,İK",
  rgDate: "2003-06-10",
  rgNo: "25134",
  fullText: "İŞ KANUNU ... tam metin ...".padEnd(500, "."),
  sourceKey: "MEVZUAT_GOV",
  sourceUrl: "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=4857&MevzuatTur=1&MevzuatTertip=5",
};

const ARTICLES_V1: ParsedStatuteArticle[] = [
  { articleNo: "1", text: "Madde 1- (1) Bu Kanunun amacı işçilerin işyerinde..." },
  { articleNo: "25", text: "Madde 25- (1) Süresi belirsiz iş sözleşmelerinin feshi..." },
];

interface Harness {
  svc: LegislationPoolService;
  statuteCreate: () => Record<string, unknown> | undefined;
  statuteUpdate: () => Record<string, unknown> | undefined;
  articleCreates: () => Array<Record<string, unknown>>;
  articleUpdates: () => Array<Record<string, unknown>>;
  legislationCreates: () => Array<Record<string, unknown>>;
  auditLines: string[];
}

function serviceWith(overrides: {
  existingStatute?: Record<string, unknown> | null;
  existingArticles?: Array<Record<string, unknown>>;
  existingLegislation?: Record<string, unknown> | null;
}): Harness {
  const statuteCreateCalls: Array<Record<string, unknown>> = [];
  const statuteUpdateCalls: Array<Record<string, unknown>> = [];
  const articleCreateCalls: Array<Record<string, unknown>> = [];
  const articleUpdateCalls: Array<Record<string, unknown>> = [];
  const legislationCreateCalls: Array<Record<string, unknown>> = [];
  const auditLines: string[] = [];

  const statuteTable = {
    findUnique: async () => {
      if (!overrides.existingStatute) return null;
      return {
        ...overrides.existingStatute,
        articles: overrides.existingArticles ?? [],
      };
    },
    create: async (args: { data: Record<string, unknown> }) => {
      statuteCreateCalls.push(args.data);
      return { id: "st-1", ...args.data };
    },
    update: async (args: { data: Record<string, unknown> }) => {
      statuteUpdateCalls.push(args.data);
      return { id: "st-1", ...args.data };
    },
  };
  const articleTable = {
    create: async (args: { data: Record<string, unknown> }) => {
      articleCreateCalls.push(args.data);
      return { id: `sav-${articleCreateCalls.length}`, ...args.data };
    },
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      articleCreateCalls.push(...args.data);
      return { count: args.data.length };
    },
    update: async (args: { data: Record<string, unknown> }) => {
      articleUpdateCalls.push(args.data);
      return {};
    },
    updateMany: async (args: { data: Record<string, unknown> }) => {
      articleUpdateCalls.push(args.data);
      return { count: 1 };
    },
  };
  const legislationTable = {
    findFirst: async () => overrides.existingLegislation ?? null,
    create: async (args: { data: Record<string, unknown> }) => {
      legislationCreateCalls.push(args.data);
      return { id: "lg-1", ...args.data };
    },
    update: async (args: { data: Record<string, unknown> }) => ({ id: "lg-1", ...args.data }),
  };
  const client = {
    statute: statuteTable,
    statuteArticleVersion: articleTable,
    legislation: legislationTable,
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(client),
  };
  const prisma = { client } as unknown as PrismaService;
  const audit = {
    log: async (e: { detail: string }) => {
      auditLines.push(e.detail);
    },
  } as unknown as PlatformAuditService;
  return {
    svc: new LegislationPoolService(prisma, audit),
    statuteCreate: () => statuteCreateCalls[0],
    statuteUpdate: () => statuteUpdateCalls[0],
    articleCreates: () => articleCreateCalls,
    articleUpdates: () => articleUpdateCalls,
    legislationCreates: () => legislationCreateCalls,
    auditLines,
  };
}

describe("importStatute — ilk giriş", () => {
  it("biçimsiz kayıt REDDEDILDI döner, hiçbir tabloya yazılmaz", async () => {
    const { svc, statuteCreate, articleCreates } = serviceWith({});
    const res = await svc.importStatute(ACTOR, {
      ...BASE_INPUT,
      mevzuatNo: "abc",
      articles: ARTICLES_V1,
    });
    expect(res.status).toBe("REDDEDILDI");
    expect(statuteCreate()).toBeUndefined();
    expect(articleCreates()).toHaveLength(0);
  });

  it("madde ayrıştırılamayan metin reddedilir", async () => {
    const { svc } = serviceWith({});
    const res = await svc.importStatute(ACTOR, { ...BASE_INPUT, articles: [] });
    expect(res.status).toBe("REDDEDILDI");
    expect(res.reason).toContain("madde");
  });

  it("kanun + maddeler sürüm 1 olarak girer (RG künyesi effectiveFrom olur)", async () => {
    const { svc, statuteCreate } = serviceWith({});
    const res = await svc.importStatute(ACTOR, { ...BASE_INPUT, articles: ARTICLES_V1 });

    expect(res.status).toBe("EKLENDI");
    expect(statuteCreate()).toMatchObject({
      mevzuatNo: "4857",
      abbrs: "İşK,İK",
      sourceKey: "MEVZUAT_GOV",
      rgNo: "25134",
    });
    const data = statuteCreate() as { articles: { create: Array<Record<string, unknown>> } };
    expect(data.articles.create).toHaveLength(2);
    expect(data.articles.create[0]).toMatchObject({ articleNo: "1", versionSeq: 1 });
  });
});

describe("importStatute — sürüm zinciri", () => {
  const EXISTING = { id: "st-1", mevzuatNo: "4857", mevzuatTur: 1, title: "İŞ KANUNU", abbrs: "İşK", rgDate: new Date("2003-06-10T00:00:00Z"), rgNo: "25134", sourceKey: "MEVZUAT_GOV", sourceUrl: null, fullText: "eski" };

  it("aynı metin ATLANDI döner — hiçbir sürüm yazılmaz", async () => {
    const { svc, articleCreates } = serviceWith({
      existingStatute: EXISTING,
      existingArticles: [
        { id: "sav-1", statuteId: "st-1", articleNo: "1", versionSeq: 1, text: ARTICLES_V1[0].text, effectiveTo: null },
        { id: "sav-2", statuteId: "st-1", articleNo: "25", versionSeq: 1, text: ARTICLES_V1[1].text, effectiveTo: null },
      ],
    });
    const res = await svc.importStatute(ACTOR, {
      ...BASE_INPUT,
      fullText: "İŞ KANUNU ... güncel tam metin ...".padEnd(500, "."),
      articles: ARTICLES_V1,
    });
    expect(res.status).toBe("ATLANDI");
    expect(articleCreates()).toHaveLength(0);
  });

  it("değişen madde: eski sürüm kapanır, yeni sürüm versionSeq+1 ile açılır (RG künyesiyle)", async () => {
    const { svc, articleCreates, articleUpdates } = serviceWith({
      existingStatute: EXISTING,
      existingArticles: [
        { id: "sav-1", statuteId: "st-1", articleNo: "1", versionSeq: 1, text: ARTICLES_V1[0].text, effectiveTo: null },
        { id: "sav-2", statuteId: "st-1", articleNo: "25", versionSeq: 1, text: "Madde 25- (1) ESKİ metin.", effectiveTo: null },
      ],
    });
    const res = await svc.importStatute(ACTOR, {
      ...BASE_INPUT,
      fullText: "İŞ KANUNU ... güncel tam metin ...".padEnd(500, "."),
      articles: [
        ARTICLES_V1[0],
        { articleNo: "25", text: "Madde 25- (1) YENİ metin: işçinin haklı fesih sebepleri..." },
      ],
      changeRgDate: "2026-08-15",
      changeRgNo: "33500",
    });

    expect(res.status).toBe("GUNCELLENDI");
    expect(res.diff).toMatchObject({ changed: 1, unchanged: 1 });
    // Eski sürüm kapatıldı.
    expect(articleUpdates().some((u) => u.effectiveTo !== undefined)).toBe(true);
    // Yeni sürüm: versionSeq 2, değişiklik RG künyesiyle.
    const newVersion = articleCreates().find((c) => c.articleNo === "25");
    expect(newVersion).toMatchObject({ versionSeq: 2, changeRgNo: "33500" });
  });

  it("kaldırılan madde kapatılır — metin silinmez (mülga geçmişi kalır)", async () => {
    const { svc, articleUpdates } = serviceWith({
      existingStatute: EXISTING,
      existingArticles: [
        { id: "sav-1", statuteId: "st-1", articleNo: "1", versionSeq: 1, text: ARTICLES_V1[0].text, effectiveTo: null },
        { id: "sav-x", statuteId: "st-1", articleNo: "99", versionSeq: 1, text: "Madde 99- (1) Kaldırılacak.", effectiveTo: null },
      ],
    });
    const res = await svc.importStatute(ACTOR, {
      ...BASE_INPUT,
      fullText: "İŞ KANUNU ... 99 gone ...".padEnd(500, "."),
      articles: [ARTICLES_V1[0]],
      changeRgDate: "2026-08-15",
    });
    expect(res.diff).toMatchObject({ removed: 1 });
    expect(articleUpdates().some((u) => u.effectiveTo !== undefined)).toBe(true);
  });
});

describe("importLegislation — kanun dışı platform kaydı", () => {
  it("yeni belge tenantId=null platform kaydı olarak girer", async () => {
    const { svc, legislationCreates } = serviceWith({});
    const res = await svc.importLegislation(ACTOR, {
      docType: "YONETMELIK",
      title: "Ödeme Hizmetleri Hakkında Yönetmelik",
      fullText: "Yönetmelik maddeleri...".padEnd(300, "."),
      sourceKey: "RG_GUNLUK",
      sourceUrl: "https://www.resmigazete.gov.tr/eskiler/2026/09/20260904-1.htm",
      rgDate: "2026-09-04",
      rgNo: "33360",
    });
    expect(res.status).toBe("EKLENDI");
    expect(legislationCreates()[0]).toMatchObject({
      tenantId: null,
      docType: "YONETMELIK",
      sourceKey: "RG_GUNLUK",
      authorityLevel: 10,
      uploadedBy: null,
    });
  });

  it("kaynaksız kayıt reddedilir (lineage zorunlu)", async () => {
    const { svc } = serviceWith({});
    await expect(
      svc.importLegislation(ACTOR, {
        docType: "TEBLIG",
        title: "X Tebliği",
        sourceKey: "",
      }),
    ).rejects.toThrow(/kaynak anahtarı/i);
  });
});
