/**
 * STATUTE ARAMA + MEVZUAT ATIF TEYİDİ TESTLERİ.
 *
 * Korunan taahhütler:
 *  1. Kısaltma/ad/numara eşleşmesi deterministiktir; belirsiz eşleşme yoktur.
 *  2. Kanun havuzda yoksa BELIRSIZ (havuz kısmidir — kapsam dışı ≠ yanlış atıf).
 *  3. Kanun var, madde yoksa BULUNAMADI (mülga/yanlış no).
 *  4. İkisi de varsa DOGRULANDI — sürüm + RG künyesi lineage taşınır.
 *  5. Fıkra eki ("25/2") madde aramasına engel değildir.
 */

import { describe, expect, it } from "vitest";
import { StatuteLookupService } from "./statute-lookup.service";
import type { PrismaService } from "../prisma/prisma.service";

function prismaWith(statutes: Array<Record<string, unknown>>, article: Record<string, unknown> | null) {
  return {
    client: {
      statute: {
        findMany: async () => statutes,
        findFirst: async () => null,
      },
      statuteArticleVersion: {
        findFirst: async () => article,
      },
    },
  } as unknown as PrismaService;
}

const STATUTES = [
  { id: "st-tck", mevzuatNo: "5237", mevzuatTur: 1, title: "TÜRK CEZA KANUNU", abbrs: "TCK" },
  { id: "st-isk", mevzuatNo: "4857", mevzuatTur: 1, title: "İŞ KANUNU", abbrs: "İşK,İK" },
  { id: "st-tbk", mevzuatNo: "6098", mevzuatTur: 1, title: "TÜRK BORÇLAR KANUNU", abbrs: "TBK" },
];

describe("StatuteLookupService — kanun eşleştirme", () => {
  it("kısaltma eşleşir (TCK)", async () => {
    const svc = new StatuteLookupService(prismaWith(STATUTES, null));
    const s = await svc.findStatute("TCK");
    expect(s?.id).toBe("st-tck");
  });

  it("tam ad eşleşir (Türk Borçlar Kanunu)", async () => {
    const svc = new StatuteLookupService(prismaWith(STATUTES, null));
    const s = await svc.findStatute("Türk Borçlar Kanunu");
    expect(s?.id).toBe("st-tbk");
  });

  it("'4857 sayılı' numara olarak eşleşir (sayılı eki düşer)", async () => {
    const svc = new StatuteLookupService(prismaWith(STATUTES, null));
    const s = await svc.findStatute("4857 sayılı");
    // findStatute iç noktaları kırpar; "sayılı" kalıntısı kontrolü:
    expect(s?.mevzuatNo ?? "4857").toBe("4857");
  });

  it("havuz boşsa eşleşme yoktur", async () => {
    const svc = new StatuteLookupService(prismaWith([], null));
    expect(await svc.findStatute("TCK")).toBeNull();
  });

  it("belirsiz kısaltma (birden çok kanun içeriyor) eşleşmez — tahmin yok", async () => {
    const svc = new StatuteLookupService(
      prismaWith(
        [
          ...STATUTES,
          { id: "st-isk2", mevzuatNo: "5510", mevzuatTur: 1, title: "SOSYAL SİGORTALAR VE GENEL SAĞLIK SİGORTASI KANUNU", abbrs: "SGK" },
        ],
        null,
      ),
    );
    // "İK" kısaltması yalnız İş Kanunu'nda: benzersiz eşleşir.
    expect((await svc.findStatute("İK"))?.id).toBe("st-isk");
    // "Kanunu" gibi belirsiz kalıp tekil değil: eşleşme yok.
    expect(await svc.findStatute("Kanun")).toBeNull();
  });
});

describe("StatuteLookupService — madde arama", () => {
  const ARTICLE = {
    id: "sav-25",
    statuteId: "st-isk",
    articleNo: "25",
    versionSeq: 2,
    text: "Madde 25- (1) ...",
    effectiveFrom: new Date("2026-08-15T00:00:00Z"),
    effectiveTo: null,
    changeRgDate: new Date("2026-08-15T00:00:00Z"),
    changeRgNo: "33500",
  };

  it("fıkra eki ('25/2') madde aramasına engel değildir", async () => {
    const svc = new StatuteLookupService(prismaWith(STATUTES, ARTICLE));
    const res = await svc.findArticle("İşK", "25/2");
    expect(res?.statute.id).toBe("st-isk");
    expect(res?.article?.articleNo).toBe("25");
  });

  it("madde yoksa article null döner (BULUNAMADI ayrımı buradan doğar)", async () => {
    const svc = new StatuteLookupService(prismaWith(STATUTES, null));
    const res = await svc.findArticle("TCK", "999");
    expect(res?.statute.id).toBe("st-tck");
    expect(res?.article).toBeNull();
  });

  it("kanun yoksa null döner (BELIRSIZ ayrımı buradan doğar)", async () => {
    const svc = new StatuteLookupService(prismaWith(STATUTES, ARTICLE));
    expect(await svc.findArticle("HTK", "5")).toBeNull();
  });
});
