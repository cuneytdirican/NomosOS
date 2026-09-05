/**
 * MEVZUAT TOPLAMA HATTI TESTLERİ (legislation-ingest).
 *
 * Korunan taahhütler:
 *  1. TOHUM: künye araması → kuyruk; HAVUZA YAZIM OLMAZ.
 *  2. RG izleyici: gün sayfası kalemleri kuyruğa externalKey (tarih-sıra) ile
 *     idempotent yazılır; ilan bölümü hariç tutulur.
 *  3. Onay → LegislationPoolService tek kapısı; tohum onayı konsolide metni
 *     çekip maddelere ayırır.
 *  4. RG KANUN onayı: değişiklik başlığından etkilenen kanun numarası çıkarılır
 *     ve o kanunun konsolide metni güncellenir (changeRg künyesiyle).
 *  5. Red gerekçesi zorunlu; BEKLIYOR olmayan kayıt işlenmez.
 *  6. RG PDF kalemleri metin önizlemesi veremez — dürüst hata.
 */

import { describe, expect, it } from "vitest";
import { LegislationIngestService } from "./legislation-ingest.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PlatformAuditService } from "../platform-audit.service";
import type { LegislationPoolService } from "./legislation-pool.service";
import type { MevzuatGovConnector } from "../../legislation/connectors/mevzuat-gov.connector";
import type { ResmiGazeteClient } from "../../legislation/connectors/resmi-gazete.client";
import type { KvkkClient } from "../../legislation/connectors/kvkk.client";
import type { RekabetClient } from "../../legislation/connectors/rekabet.client";
import { parseRgDayHtml } from "../../legislation/connectors/resmi-gazete.client";
import type { PlatformAuthUser } from "../platform.types";

const ACTOR: PlatformAuthUser = { id: "pu-1", role: "SUPER_ADMIN", ip: "127.0.0.1" } as PlatformAuthUser;
const NOW = new Date("2026-09-04T06:00:00.000Z");

interface Harness {
  svc: LegislationIngestService;
  inserted: Array<Record<string, unknown>>;
  statuteImports: () => Array<Record<string, unknown>>;
  legislationImports: () => number;
  legislationImportArgs: () => Array<Record<string, unknown>>;
  mevzuatFetches: () => Array<string>;
}

function serviceWith(overrides: {
  existingItem?: Record<string, unknown> | null;
  mevzuatDoc?: string;
}): Harness {
  const inserted: Array<Record<string, unknown>> = [];
  const statuteImports: Array<Record<string, unknown>> = [];
  const legislationImportArgs: Array<Record<string, unknown>> = [];
  let legislationImports = 0;
  const mevzuatFetches: string[] = [];

  const mevzuat = {
    key: "MEVZUAT_GOV",
    name: "Mevzuat Bilgi Sistemi",
    authorityLevel: 10,
    search: async () => ({
      total: 1,
      hits: [
        {
          externalKey: "4857.1.5",
          mevzuatNo: "4857",
          mevzuatTur: 1,
          tertip: 5,
          title: "İŞ KANUNU",
          kabulTarihi: "22.05.2003",
          rgTarihi: "10.06.2003",
          rgSayisi: "25134",
          url: "mevzuat?MevzuatNo=4857&MevzuatTur=1&MevzuatTertip=5",
          sourceUrl: "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=4857&MevzuatTur=1&MevzuatTertip=5",
        },
      ],
    }),
    fetchDocument: async (externalKey: string) => {
      mevzuatFetches.push(externalKey);
      return {
        externalKey,
        mevzuatNo: externalKey.split(".")[0],
        mevzuatTur: Number(externalKey.split(".")[1]),
        tertip: 5,
        text:
          overrides.mevzuatDoc ??
          [
            "İŞ KANUNU",
            "Kanun Numarası : 4857",
            "Yayımlandığı Resmî Gazete : Tarih : 10/06/2003 Sayı : 25134",
            "Madde 1- (1) Bu Kanunun amacı işçilerin çalışma şartlarını düzenlemektir.",
            "Madde 25- (1) İşveren, iş sözleşmesini haklı sebeple feshedebilir.",
          ].join("\n"),
        sourceUrl: `https://www.mevzuat.gov.tr/x/${externalKey}`,
      };
    },
    healthCheck: async () => ({ key: "MEVZUAT_GOV", name: "x", healthy: true, message: "ok", checkedAt: new Date() }),
  } as unknown as MevzuatGovConnector;

  const rg = {
    fetchDay: async () => ({
      date: "2026-09-03",
      rgNo: "33359",
      items: [
        {
          order: 1,
          section: "KANUN",
          docType: "KANUN",
          title: "4857 SAYILI İŞ KANUNUNUN 25 İNCİ MADDESİNDE DEĞİŞİKLİK YAPILMASINA DAİR KANUN",
          url: "https://www.resmigazete.gov.tr/eskiler/2026/09/20260903-1.htm",
          isHtml: true,
        },
        {
          order: 2,
          section: "YÖNETMELİK",
          docType: "YONETMELIK",
          title: "Ödeme Hizmetleri Hakkında Yönetmelikte Değişiklik Yapılmasına Dair Yönetmelik",
          url: "https://www.resmigazete.gov.tr/eskiler/2026/09/20260903-2.htm",
          isHtml: true,
        },
      ],
    }),
    fetchDocumentText: async () =>
      "4857 sayılı İş Kanununun 25 inci maddesi aşağıdaki şekilde değiştirilmiştir.\nMadde 25- (1) Yeni fesih hükümleri...".padEnd(300, "."),
  } as unknown as ResmiGazeteClient;

  const kvkk = {
    fetchDecisionList: async (page: number) =>
      page === 1
        ? [
            {
              title: "Köy Tüzel Kişiliklerinin VERBİS Kayıt Yükümlülüğünden İstisna Tutulması Hakkında Karar",
              url: "https://www.kvkk.gov.tr/Icerik/7791/2023-2135",
              isPdf: false,
            },
            {
              title: "Sadakat Kart Üyeliği Bulunan Bir Kişinin Cep Telefonu Numarasının Paylaşılması",
              url: "https://www.resmigazete.gov.tr/eskiler/2026/08/20260813-3.pdf",
              isPdf: true,
            },
          ]
        : [],
    fetchDecisionText: async () =>
      "Karar Tarihi : 14/12/2023\nKarar No : 2023/2135\nKonu Özeti : Köy tüzel kişiliklerinin " +
        "Veri Sorumluları Siciline kayıt yükümlülüğünden istisna tutulması... ".padEnd(300, "."),
  } as unknown as KvkkClient;

  const rekabet = {
    fetchDecisionList: async (page: number) =>
      page === 1
        ? [
            {
              title: "Rekabet Kurulunun Yemek Sepeti hakkında soruşturmasında taahhütlerin kaldırılması kararı",
              kararSayisi: "25-44/1086-615",
              kararTarihi: "27.11.2025",
              kararTuru: "Rekabet İhlali",
              detailUrl: "https://www.rekabet.gov.tr/Karar?kararId=88f38c4f-97ec-4db7-88a5-6ba138bbfb17",
              kararId: "88f38c4f-97ec-4db7-88a5-6ba138bbfb17",
            },
          ]
        : [],
  } as unknown as RekabetClient;

  const pool = {
    importStatute: async (_user: PlatformAuthUser, input: Record<string, unknown>) => {
      statuteImports.push(input);
      return { status: "EKLENDI", statuteId: "st-1" };
    },
    importLegislation: async (_user: unknown, input: Record<string, unknown>) => {
      legislationImports += 1;
      legislationImportArgs.push(input);
      return { status: "EKLENDI", id: "lg-1" };
    },
  } as unknown as LegislationPoolService;

  const prisma = {
    client: {
      legislationIngestItem: {
        // skipDuplicates benzetimi: @@unique(sourceKey, externalKey).
        createMany: async (args: { data: Array<Record<string, unknown>> }) => {
          const seenKeys = new Set(inserted.map((i) => `${i.sourceKey}|${i.externalKey}`));
          let count = 0;
          for (const row of args.data) {
            const key = `${row.sourceKey}|${row.externalKey}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            inserted.push(row);
            count += 1;
          }
          return { count };
        },
        findUnique: async () => overrides.existingItem ?? null,
        update: async (args: { data: Record<string, unknown> }) => ({
          id: "qi-1",
          status: args.data.status ?? "BEKLIYOR",
          ...args.data,
        }),
        findMany: async () => [],
        groupBy: async () => [],
      },
    },
  } as unknown as PrismaService;
  const audit = { log: async () => undefined } as unknown as PlatformAuditService;

  return {
    svc: new LegislationIngestService(prisma, audit, pool, mevzuat, rg, kvkk, rekabet),
    inserted,
    statuteImports: () => statuteImports,
    legislationImports: () => legislationImports,
    legislationImportArgs: () => legislationImportArgs,
    mevzuatFetches: () => mevzuatFetches,
  };
}

describe("Tohum — künye araması kuyruğa yazar", () => {
  it("çekirdek kanun künyesiyle kuyruğa girer; havuza yazılmaz", async () => {
    const { svc, inserted, statuteImports } = serviceWith({});
    const summary = await svc.runCoreSeed(NOW);

    expect(summary.queued).toBeGreaterThanOrEqual(1);
    const isKanun = inserted.find((i) => i.number === "4857");
    expect(isKanun).toMatchObject({
      sourceKey: "MEVZUAT_TOHUM",
      externalKey: "4857.1.5",
      abbrs: "İşK,İK",
      rgNo: "25134",
    });
    expect(statuteImports()).toHaveLength(0);
  });
});

describe("RG izleyici — gün sayfası kuyruğa yazılır", () => {
  it("kalemler tarih-sıra externalKey ile kuyruğa girer (ilan hariç)", async () => {
    const { svc, inserted } = serviceWith({});
    const summary = await svc.runRgWatcher(NOW);

    expect(summary.ok).toBe(true);
    expect(summary.queued).toBe(2);
    expect(inserted[0]).toMatchObject({
      sourceKey: "RG_GUNLUK",
      externalKey: "2026-09-03-1",
      docType: "KANUN",
      rgNo: "33359",
    });
    expect(inserted[1]).toMatchObject({ externalKey: "2026-09-03-2", docType: "YONETMELIK" });
  });
});

describe("KVKK izleyici — Kurul kararları kuyruğa yazılır", () => {
  it("kalemler kaynak URL'sini externalKey yaparak kuyruğa girer; PDF kalemler de girer", async () => {
    const { svc, inserted } = serviceWith({});
    const summary = await svc.runKvkkWatcher(NOW);

    expect(summary.queued).toBe(2);
    expect(inserted[0]).toMatchObject({
      sourceKey: "KVKK_KURUL",
      externalKey: "https://www.kvkk.gov.tr/Icerik/7791/2023-2135",
      docType: "DIGER",
    });
    expect(inserted[1].externalKey).toContain("resmigazete");
  });
});

describe("KVKK onayı", () => {
  it("karar metni çekilir; künyeden karar no çıkarılıp Legislation platform kaydı yazılır", async () => {
    const { svc, legislationImportArgs } = serviceWith({
      existingItem: {
        id: "kv-1",
        status: "BEKLIYOR",
        sourceKey: "KVKK_KURUL",
        externalKey: "https://www.kvkk.gov.tr/Icerik/7791/2023-2135",
        docType: "DIGER",
        title: "Köy Tüzel Kişiliklerinin VERBİS Kayıt Yükümlülüğünden İstisna Tutulması Hakkında Karar",
        number: null,
        abbrs: null,
        rgDate: null,
        rgNo: null,
        sourceUrl: "https://www.kvkk.gov.tr/Icerik/7791/2023-2135",
        fullText: null,
      },
    });
    const res = await svc.approveItem(ACTOR, "kv-1");

    expect(res.item.status).toBe("ONAYLANDI");
    expect(res.poolOutcome).toBe("LEGISLATION");
    const input = legislationImportArgs()[0];
    expect(input.sourceKey).toBe("KVKK_KURUL");
    expect(input.fullText).toContain("Konu Özeti");
    expect(input.rgDate).toBe("2023-12-14");
    expect(input.versionNote).toContain("2023/2135");
  });

  it("RG PDF kalemi önizlemesi dürüst hata verir", async () => {
    const { svc } = serviceWith({
      existingItem: {
        id: "kv-2",
        status: "BEKLIYOR",
        sourceKey: "KVKK_KURUL",
        externalKey: "https://www.resmigazete.gov.tr/eskiler/2026/08/20260813-3.pdf",
        docType: "DIGER",
        title: "Sadakat Kart Kararı",
        number: null,
        abbrs: null,
        rgDate: null,
        rgNo: null,
        sourceUrl: "https://www.resmigazete.gov.tr/eskiler/2026/08/20260813-3.pdf",
        fullText: null,
      },
    });
    await expect(svc.preview("kv-2")).rejects.toThrow(/RG PDF/);
  });
});

describe("Rekabet izleyici — Kurul kararları kuyruğa yazılır", () => {
  it("künye (karar sayısı) kuyruk kaydına taşınır; externalKey = kararId", async () => {
    const { svc, inserted } = serviceWith({});
    const summary = await svc.runRekabetWatcher(NOW);

    expect(summary.queued).toBe(1);
    expect(inserted[0]).toMatchObject({
      sourceKey: "REKABET_KURUL",
      externalKey: "88f38c4f-97ec-4db7-88a5-6ba138bbfb17",
      number: "25-44/1086-615",
    });
  });

  it("onay: künyeyle Legislation platform kaydı yazılır (PDF metni yok)", async () => {
    const { svc, legislationImportArgs } = serviceWith({
      existingItem: {
        id: "rk-1",
        status: "BEKLIYOR",
        sourceKey: "REKABET_KURUL",
        externalKey: "88f38c4f-97ec-4db7-88a5-6ba138bbfb17",
        docType: "DIGER",
        title: "Yemek Sepeti taahhüt kararı",
        number: "25-44/1086-615",
        abbrs: null,
        rgDate: null,
        rgNo: null,
        sourceUrl: "https://www.rekabet.gov.tr/Karar?kararId=88f38c4f",
        fullText: null,
      },
    });
    const res = await svc.approveItem(ACTOR, "rk-1");

    expect(res.item.status).toBe("ONAYLANDI");
    const input = legislationImportArgs()[0];
    expect(input.sourceKey).toBe("REKABET_KURUL");
    expect(input.versionNote).toContain("25-44/1086-615");
  });

  it("metin önizlemesi dürüst hata verir (PDF)", async () => {
    const { svc } = serviceWith({
      existingItem: {
        id: "rk-2",
        status: "BEKLIYOR",
        sourceKey: "REKABET_KURUL",
        externalKey: "x",
        docType: "DIGER",
        title: "X",
        number: null,
        abbrs: null,
        rgDate: null,
        rgNo: null,
        sourceUrl: "https://www.rekabet.gov.tr/Karar?kararId=y",
        fullText: null,
      },
    });
    await expect(svc.preview("rk-2")).rejects.toThrow(/PDF/);
  });
});

describe("Onay — tek kapı", () => {
  it("TOHUM onayı: konsolide metin çekilir, maddelere ayrılır, Statute'a girer", async () => {
    const { svc, statuteImports, mevzuatFetches } = serviceWith({
      existingItem: {
        id: "qi-1",
        status: "BEKLIYOR",
        sourceKey: "MEVZUAT_TOHUM",
        externalKey: "4857.1.5",
        docType: "KANUN",
        title: "İŞ KANUNU",
        number: "4857",
        abbrs: "İşK,İK",
        rgDate: new Date("2003-06-10T00:00:00Z"),
        rgNo: "25134",
        sourceUrl: null,
        fullText: null,
      },
    });
    const res = await svc.approveItem(ACTOR, "qi-1");

    expect(res.item.status).toBe("ONAYLANDI");
    expect(res.poolOutcome).toBe("EKLENDI");
    expect(mevzuatFetches()).toEqual(["4857.1.5"]);
    const input = statuteImports()[0];
    expect(input.articles).toHaveLength(2);
    expect(input.sourceKey).toBe("MEVZUAT_GOV");
    expect(input.rgNo).toBe("25134");
  });

  it("RG KANUN onayı: etkilenen kanun numarası başlıktan çıkar, konsolide metni sürümlenir", async () => {
    const { svc, statuteImports, mevzuatFetches } = serviceWith({
      existingItem: {
        id: "qi-2",
        status: "BEKLIYOR",
        sourceKey: "RG_GUNLUK",
        externalKey: "2026-09-03-1",
        docType: "KANUN",
        title: "4857 SAYILI İŞ KANUNUNUN 25 İNCİ MADDESİNDE DEĞİŞİKLİK YAPILMASINA DAİR KANUN",
        rgDate: new Date("2026-09-03T00:00:00Z"),
        rgNo: "33359",
        sourceUrl: "https://www.resmigazete.gov.tr/eskiler/2026/09/20260903-1.htm",
        fullText: null,
      },
    });
    const res = await svc.approveItem(ACTOR, "qi-2");

    expect(res.item.status).toBe("ONAYLANDI");
    expect(mevzuatFetches()).toContain("4857.1.5");
    const input = statuteImports().find((i) => i.mevzuatNo === "4857");
    expect(input?.changeRgDate).toBe("2026-09-03");
    expect(input?.changeRgNo).toBe("33359");
  });

  it("RG PDF kalemi önizlemesi dürüst hata verir — uydurma metin yok", async () => {
    const { svc } = serviceWith({
      existingItem: {
        id: "qi-3",
        status: "BEKLIYOR",
        sourceKey: "RG_GUNLUK",
        externalKey: "2026-09-03-9",
        docType: "DIGER",
        title: "Kurul Kararı",
        rgDate: null,
        rgNo: null,
        sourceUrl: "https://www.resmigazete.gov.tr/eskiler/2026/09/20260903-9.pdf",
        fullText: null,
      },
    });
    await expect(svc.preview("qi-3")).rejects.toThrow(/PDF/);
  });

  it("BEKLIYOR olmayan kayıt onaylanamaz; red gerekçesi zorunlu", async () => {
    const { svc } = serviceWith({
      existingItem: {
        id: "qi-4",
        status: "ONAYLANDI",
        sourceKey: "RG_GUNLUK",
        externalKey: "x",
        docType: "KANUN",
        title: "X",
      },
    });
    await expect(svc.approveItem(ACTOR, "qi-4")).rejects.toThrow(/yalnız BEKLIYOR/);
    await expect(svc.rejectItem(ACTOR, "qi-4", "gerekçe")).rejects.toThrow(/yalnız BEKLIYOR/);
  });

  it("red gerekçesiz OLMAZ (şema) — servis gerekçeyi kayda yazar", async () => {
    const { svc } = serviceWith({
      existingItem: {
        id: "qi-5",
        status: "BEKLIYOR",
        sourceKey: "RG_GUNLUK",
        externalKey: "y",
        docType: "TEBLIG",
        title: "Y Tebliği",
      },
    });
    const res = await svc.rejectItem(ACTOR, "qi-5", "Metin kaynakla uyuşmuyor");
    expect(res.status).toBe("REDDEDILDI");
    expect(res.rejectReason).toBe("Metin kaynakla uyuşmuyor");
  });
});

describe("parseRgDayHtml — gün sayfası ayrıştırıcı (doğrulanmış HTML biçimi)", () => {
  const HTML = [
    '<html><head><title>T.C. Resmî Gazete</title></head><body>',
    "<p><b><u><font>YÜRÜTME VE İDARE BÖLÜMÜ</font></u></b></p>",
    "<p><b><u><font>YÖNETMELİK</font></u></b></p>",
    '<p><a href="20260904-1.htm">––&nbsp; Ödeme Hizmetleri Yönetmeliğinde Değişiklik</a></p>',
    "<p><b><u><font>TEBLİĞ</font></u></b></p>",
    '<p><a href="20260904-2.htm">––&nbsp; Veri Paylaşımına İlişkin Tebliğ</a></p>',
    "<p><b><u><font>KURUL KARARLARI</font></u></b></p>",
    '<p><a href="20260904-3.pdf">––&nbsp; Enerji Piyasası Düzenleme Kurulu Kararı</a></p>',
    "</body></html>",
  ].join("\n");

  it("bölüm başlıkları belge türüne çevrilir; sıra externalKey üretir", () => {
    const items = parseRgDayHtml(HTML, "2026-09-04");
    expect(items.map((i) => i.docType)).toEqual(["YONETMELIK", "TEBLIG", "DIGER"]);
    expect(items[0].title).toBe("Ödeme Hizmetleri Yönetmeliğinde Değişiklik");
    expect(items[0].url).toBe("https://www.resmigazete.gov.tr/eskiler/2026/09/20260904-1.htm");
    expect(items[2].isHtml).toBe(false);
  });

  it("KANUN bölüm başlığı KANUN türüne çevrilir", () => {
    const items = parseRgDayHtml(
      '<p><b><u><font>KANUN</font></u></b></p><p><a href="20260904-9.htm">Kanun başlığı</a></p>',
      "2026-09-04",
    );
    expect(items[0].docType).toBe("KANUN");
  });

  it("bağlantı olmayan sayfa boş döner (sessiz uydurma yok)", () => {
    expect(parseRgDayHtml("<p>bozuk sayfa</p>", "2026-09-04")).toEqual([]);
  });
});
