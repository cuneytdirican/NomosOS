/**
 * İÇTİHAT TOPLAMA HATTI TESTLERİ (caselaw-ingest).
 *
 * Korunan taahhütler:
 *  1. Besleme sözleşmeye uymuyorsa (records[] değil) ÇEKİM HATA verir — sessiz
 *     boş geçiş yoktur.
 *  2. Biçimsiz künye / makul olmayan tarih KUYRUĞA DA GİREMEZ.
 *  3. Aynı partide aynı künye ikinci kez kuyruğa girmez.
 *  4. createMany skipDuplicates: daha önce işlenmiş künye yeniden kuyruğa ALINMAZ.
 *  5. Onay, havuza CaselawPoolService'ten geçer (tek kapı) ve kuyruk kaydı
 *     ONAYLANDI olur; havuz reddederse kuyruk kaydı REDDEDILDI olur.
 *  6. Onay/red yalnız BEKLIYOR kayıtlarda; red gerekçesi zorunlu.
 *  7. Çekim HAVUZA yazmaz — yalnız kuyruğa.
 */

import { describe, expect, it, vi } from "vitest";
import { CaselawIngestService } from "./caselaw-ingest.service";
import { feedResponseSchema, sourceUpsertSchema } from "./caselaw-ingest.schemas";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PlatformAuditService } from "../platform-audit.service";
import type { CaselawPoolService } from "../caselaw-pool/caselaw-pool.service";
import type { YargitayLiveAdapter } from "../../caselaw/adapters/yargitay-live.adapter";
import type { LiveCaseLawDocument } from "../../caselaw/adapters/yargitay-live.adapter";
import type { PlatformAuthUser } from "../platform.types";

const ACTOR: PlatformAuthUser = { id: "pu-1", role: "SUPER_ADMIN", ip: "127.0.0.1" } as PlatformAuthUser;
const NOW = new Date("2026-09-04T06:00:00.000Z");

interface Harness {
  svc: CaselawIngestService;
  inserted: Array<Record<string, unknown>>;
  /** poolCalls kapanış değişkeni — sayıyı değer olarak döndürmek anlık görüntü alırdı. */
  poolCallCount: () => number;
  auditLines: string[];
  /** Canlı adaptör çağrı sayısı (önizleme testleri). */
  liveFetchCount: () => number;
}

function serviceWith(overrides: {
  existingPoolRecord?: Record<string, unknown> | null;
  poolOutcome?: "EKLENDI" | "GUNCELLENDI" | "ATLANDI" | "REDDEDILDI";
  liveDocument?: LiveCaseLawDocument | null;
  liveError?: Error;
}): Harness {
  const inserted: Array<Record<string, unknown>> = [];
  const auditLines: string[] = [];
  let poolCalls = 0;
  const prisma = {
    client: {
      caselawSourceConfig: {
        findMany: async () => [{ id: "src-1", key: "FEED_TEST", baseUrl: "http://x/feed.json" }],
        update: async () => ({}),
      },
      caseLawIngestItem: {
        createMany: async (args: { data: Array<Record<string, unknown>> }) => {
          // skipDuplicates benzetimi: partide mükerrer künye yoksa hepsi girer.
          inserted.push(...args.data);
          return { count: args.data.length };
        },
        findUnique: async () => overrides.existingPoolRecord ?? null,
        update: async (args: { data: Record<string, unknown> }) => ({
          id: "qi-1",
          status: args.data.status ?? "BEKLIYOR",
          ...args.data,
        }),
        groupBy: async () => [],
      },
      caseLawDocument: {
        findUnique: async () => ({ id: "cl-new-1" }),
      },
    },
  } as unknown as PrismaService;
  const audit = {
    log: async (e: { detail: string }) => {
      auditLines.push(e.detail);
    },
  } as unknown as PlatformAuditService;
  const pool = {
    importRecords: async () => {
      poolCalls += 1;
      return {
        results: [
          {
            index: 0,
            court: "Yargıtay 9. Hukuk Dairesi",
            caseNumber: "2016/1234",
            decisionNumber: "2017/5678",
            status: overrides.poolOutcome ?? "EKLENDI",
          },
        ],
        counts: { added: 1, updated: 0, skipped: 0, rejected: 0, total: 1 },
      };
    },
  } as unknown as CaselawPoolService;
  let liveCalls = 0;
  const liveAdapter = {
    fetchDocument: async (externalId: string) => {
      liveCalls += 1;
      if (overrides.liveError) throw overrides.liveError;
      return (
        overrides.liveDocument ?? {
          externalId,
          text: "TEMYİZ İSTEMİ ÜZERİNDE ... gerekçeli karar metni.",
          sourceUrl: `https://karararama.yargitay.gov.tr/getDokuman?id=${externalId}`,
        }
      );
    },
  } as unknown as YargitayLiveAdapter;
  return {
    svc: new CaselawIngestService(prisma, audit, pool, liveAdapter),
    inserted,
    poolCallCount: () => poolCalls,
    auditLines,
    liveFetchCount: () => liveCalls,
  };
}

const FEED = {
  records: [
    {
      court: "Yargıtay 9. Hukuk Dairesi",
      caseNumber: "2016/1234",
      decisionNumber: "2017/5678",
      decisionDate: "2017-06-15",
      summary: "İş kazasında tazminat sorumluluğu.",
    },
  ],
};

// runSource doğrudan besleme çekimi yapar; global fetch mock'lanır.
function mockFeed(payload: unknown, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    text: async () => JSON.stringify(payload),
  } as unknown as Response);
}

describe("Besleme sözleşmesi", () => {
  it("geçerli records[] kabul edilir", () => {
    expect(feedResponseSchema.safeParse(FEED).success).toBe(true);
  });

  it("records alanı olmayan yanıt reddedilir", () => {
    expect(feedResponseSchema.safeParse({ data: [] }).success).toBe(false);
    expect(feedResponseSchema.safeParse({}).success).toBe(false);
  });

  it("kaynak anahtarı yalnız BÜYÜK harf/rakam/alt çizgi", () => {
    expect(sourceUpsertSchema.safeParse({
      key: "FEED_TEST",
      name: "Test beslemesi",
      baseUrl: "http://web:3000/feeds/x.json",
      isEnabled: true,
    }).success).toBe(true);
    expect(sourceUpsertSchema.safeParse({
      key: "feed-test",
      name: "Test beslemesi",
      baseUrl: "http://web:3000/feeds/x.json",
    }).success).toBe(false);
  });
});

describe("Çekim → onay kuyruğu", () => {
  it("geçerli kayıt KUYRUĞA girer; havuza yazım OLMAZ", async () => {
    const fetchMock = mockFeed(FEED);
    const { svc, inserted, poolCallCount } = serviceWith({});
    const summary = await svc.runSource({ id: "src-1", key: "FEED_TEST", baseUrl: "http://x" }, NOW);
    fetchMock.mockRestore();

    expect(summary.ok).toBe(true);
    expect(summary.queued).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ sourceKey: "FEED_TEST" });
    expect(inserted[0].batchId).toMatch(/^ingest-/);
    // ÇEKİM havuza yazmaz — onay ayrı adımdır.
    expect(poolCallCount()).toBe(0);
  });

  it("makul olmayan karar tarihi kuyruğa girmez (reddedilir)", async () => {
    const fetchMock = mockFeed({
      records: [{ ...FEED.records[0], decisionDate: "1850-01-01" }],
    });
    const { svc, inserted } = serviceWith({});
    const summary = await svc.runSource({ id: "src-1", key: "FEED_TEST", baseUrl: "http://x" }, NOW);
    fetchMock.mockRestore();

    expect(summary.rejected).toBe(1);
    expect(summary.queued).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("aynı partide mükerrer künye reddedilir", async () => {
    const fetchMock = mockFeed({ records: [FEED.records[0], FEED.records[0]] });
    const { svc } = serviceWith({});
    const summary = await svc.runSource({ id: "src-1", key: "FEED_TEST", baseUrl: "http://x" }, NOW);
    fetchMock.mockRestore();

    expect(summary.queued).toBe(1);
    expect(summary.rejected).toBe(1);
  });

  it("HTTP hatası kaynak özetine HATA olarak düşer, işi düşürmez", async () => {
    const fetchMock = mockFeed({}, false);
    const { svc } = serviceWith({});
    const summaries = await svc.runAllSources(NOW);
    fetchMock.mockRestore();

    expect(summaries).toHaveLength(1);
    expect(summaries[0].ok).toBe(false);
    expect(summaries[0].note).toContain("503");
  });

  it("besleme kaydının dış kaynak kimliği (externalId) kuyruğa externalRef olarak yazılır", async () => {
    const fetchMock = mockFeed({ records: [{ ...FEED.records[0], externalId: "98765" }] });
    const { svc, inserted } = serviceWith({});
    await svc.runSource({ id: "src-1", key: "FEED_TEST", baseUrl: "http://x" }, NOW);
    fetchMock.mockRestore();

    expect(inserted).toHaveLength(1);
    expect(inserted[0].externalRef).toBe("98765");
  });

  it("kimlik `id` alanıyla geldiyse de externalRef yazılır; kimlik yoksa null kalır", async () => {
    const fetchMock = mockFeed({
      records: [{ ...FEED.records[0], id: "11111" }, { ...FEED.records[0], caseNumber: "2016/5678" }],
    });
    const { svc, inserted } = serviceWith({});
    const summary = await svc.runSource({ id: "src-1", key: "FEED_TEST", baseUrl: "http://x" }, NOW);
    fetchMock.mockRestore();

    expect(summary.queued).toBe(2);
    expect(inserted[0].externalRef).toBe("11111");
    expect(inserted[1].externalRef).toBeNull();
  });
});

describe("Onay / red", () => {
  const PENDING_ITEM = {
    id: "qi-1",
    status: "BEKLIYOR",
    sourceKey: "FEED_TEST",
    court: "Yargıtay 9. Hukuk Dairesi",
    chamber: null,
    caseNumber: "2016/1234",
    decisionNumber: "2017/5678",
    decisionDate: new Date("2017-06-15T00:00:00Z"),
    summary: "Özet",
    fullText: null,
    sourceUrl: null,
  };

  it("onay havuza CaselawPoolService'ten geçer ve kaydı ONAYLANDI yapar", async () => {
    const { svc, poolCallCount } = serviceWith({ existingPoolRecord: PENDING_ITEM, poolOutcome: "EKLENDI" });
    const res = await svc.approveItem(ACTOR, "qi-1");

    expect(poolCallCount()).toBe(1);
    expect(res.poolOutcome).toBe("EKLENDI");
    expect(res.item.status).toBe("ONAYLANDI");
    expect(res.item.poolRecordId).toBe("cl-new-1");
  });

  it("havuz reddederse kuyruk kaydı da REDDEDILDI olur", async () => {
    const { svc } = serviceWith({ existingPoolRecord: PENDING_ITEM, poolOutcome: "REDDEDILDI" });
    const res = await svc.approveItem(ACTOR, "qi-1");

    expect(res.item.status).toBe("REDDEDILDI");
    expect(res.item.rejectReason).toBeTruthy();
  });

  it("BEKLIYOR olmayan kayıt onaylanamaz", async () => {
    const { svc } = serviceWith({
      existingPoolRecord: { ...PENDING_ITEM, status: "ONAYLANDI" },
    });
    await expect(svc.approveItem(ACTOR, "qi-1")).rejects.toThrow(/yalnız BEKLIYOR/);
  });

  it("red gerekçeyi kayda ve denetim izine yazar", async () => {
    const { svc, auditLines } = serviceWith({ existingPoolRecord: PENDING_ITEM });
    const res = await svc.rejectItem(ACTOR, "qi-1", "Künye kaynakla doğrulanamadı");

    expect(res.status).toBe("REDDEDILDI");
    expect(res.rejectReason).toBe("Künye kaynakla doğrulanamadı");
    expect(auditLines.some((l) => l.includes("Künye kaynakla doğrulanamadı"))).toBe(true);
  });
});

describe("Önizleme (onay öncesi okuma — Onay Masası)", () => {
  const PENDING_PREVIEW = {
    id: "qi-1",
    status: "BEKLIYOR",
    sourceKey: "FEED_TEST",
    court: "Yargıtay 9. Hukuk Dairesi",
    chamber: null,
    caseNumber: "2016/1234",
    decisionNumber: "2017/5678",
    decisionDate: new Date("2017-06-15T00:00:00Z"),
    summary: "Özet",
    fullText: null as string | null,
    sourceUrl: null,
    externalRef: null as string | null,
  };

  it("fullText VARSA kuyruk metni döner — canlı kaynağa gidilmez", async () => {
    const { svc, liveFetchCount } = serviceWith({
      existingPoolRecord: { ...PENDING_PREVIEW, fullText: "Kuyrukta saklı karar metni." },
    });
    const res = await svc.preview("qi-1");

    expect(res.source).toBe("KUYRUK");
    expect(res.text).toBe("Kuyrukta saklı karar metni.");
    expect(liveFetchCount()).toBe(0);
  });

  it("fullText YOKSA externalRef ile resmî kaynaktan temiz metin çeker", async () => {
    const { svc, liveFetchCount } = serviceWith({
      existingPoolRecord: { ...PENDING_PREVIEW, externalRef: "123456" },
    });
    const res = await svc.preview("qi-1");

    expect(res.source).toBe("CANLI");
    expect(res.text).toContain("karar metni");
    expect(res.item.externalRef).toBe("123456");
    expect(res.sourceUrl).toContain("getDokuman?id=123456");
    expect(liveFetchCount()).toBe(1);
  });

  it("fullText de externalRef de yoksa DÜRÜST hata verir — uydurma metin gösterilmez", async () => {
    const { svc, liveFetchCount } = serviceWith({ existingPoolRecord: PENDING_PREVIEW });
    await expect(svc.preview("qi-1")).rejects.toThrow(/karar metni yok.*dış kaynak kimliği/i);
    expect(liveFetchCount()).toBe(0);
  });

  it("canlı kaynak hatası dürüst mesajla yansır — önizleme onay/red akışını düşürmez", async () => {
    const { svc } = serviceWith({
      existingPoolRecord: { ...PENDING_PREVIEW, externalRef: "123456" },
      liveError: new Error("karararama.yargitay.gov.tr 503 döndü."),
    });
    await expect(svc.preview("qi-1")).rejects.toThrow(/alınamadı.*503/);
  });
});
