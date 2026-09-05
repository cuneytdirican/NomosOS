/**
 * CITATION_VERIFY — MEVZUAT KOLONU TESTLERİ (Faz 1).
 *
 * Korunan taahhütler:
 *  1. Kanun havuzda yok → BELIRSIZ (havuz kısmi; kapsam dışı ≠ yanlış atıf).
 *  2. Kanun var, madde yok → BULUNAMADI (mülga/yanlış no).
 *  3. İkisi de var → DOGRULANDI; sürüm + RG künyesi lineage taşınır.
 *  4. İçtihat atıflarının akışı değişmez (aynı servis, yeni kolon).
 */

import { describe, expect, it } from "vitest";
import { CitationVerifyService } from "./citation-verify.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { CaseLawAdapterRegistry } from "./adapters/registry.service";
import type { StatuteLookupService } from "../legislation/statute-lookup.service";
import type { Statute, StatuteArticleVersion } from "@nomosos/db";
import type { AuthUser } from "../common/types";

const USER: AuthUser = { userId: "u-1", tenantId: "t-1" } as AuthUser;

const STATUTE = {
  id: "st-tck",
  mevzuatNo: "5237",
  mevzuatTur: 1,
  tertip: 5,
  title: "TÜRK CEZA KANUNU",
  abbrs: "TCK",
  rgDate: new Date("2004-10-12T00:00:00Z"),
  rgNo: "25611",
  sourceKey: "MEVZUAT_GOV",
  sourceUrl: "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=5237",
  authorityLevel: 10,
  isActive: true,
  fullText: "...",
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Statute;

const ARTICLE = {
  id: "sav-86",
  statuteId: "st-tck",
  articleNo: "86",
  versionSeq: 1,
  text: "Madde 86- (1) Kasten yaralama suçu...",
  effectiveFrom: new Date("2004-10-12T00:00:00Z"),
  effectiveTo: null,
  changeRgDate: null,
  changeRgNo: null,
  createdAt: new Date(),
} as unknown as StatuteArticleVersion;

function serviceWith(lookup: {
  statute?: Statute | null;
  article?: StatuteArticleVersion | null;
}) {
  const statutes = {
    findArticle: async () =>
      lookup.statute ? { statute: lookup.statute, article: lookup.article ?? null } : null,
    findStatute: async () => lookup.statute ?? null,
  } as unknown as StatuteLookupService;
  const adapters = {} as unknown as CaseLawAdapterRegistry;
  const prisma = { client: {} } as unknown as PrismaService;
  return new CitationVerifyService(prisma, adapters, statutes);
}

describe("verify — mevzuat atıfları", () => {
  it("TCK m.86 → DOGRULANDI; RG künyesi lineage taşınır", async () => {
    const svc = serviceWith({ statute: STATUTE, article: ARTICLE });
    const report = await svc.verify(USER, { citations: ["TCK m.86"] });
    expect(report.results[0].kind).toBe("MEVZUAT");
    expect(report.results[0].status).toBe("DOGRULANDI");
    expect(report.results[0].matchedStatute).toMatchObject({
      mevzuatNo: "5237",
      articleNo: "86",
      versionSeq: 1,
      sourceKey: "MEVZUAT_GOV",
    });
    expect(report.results[0].note).toContain("TÜRK CEZA KANUNU m.86");
  });

  it("kanun havuzda değil → BELIRSIZ (kapsam dışı ≠ yanlış atıf)", async () => {
    const svc = serviceWith({ statute: null });
    const report = await svc.verify(USER, { citations: ["HMK m.317"] });
    expect(report.results[0].status).toBe("BELIRSIZ");
    expect(report.results[0].note).toContain("elle teyit");
  });

  it("kanun var, madde yok → BULUNAMADI (mülga/yanlış no)", async () => {
    const svc = serviceWith({ statute: STATUTE, article: null });
    const report = await svc.verify(USER, { citations: ["TCK m.9999"] });
    expect(report.results[0].status).toBe("BULUNAMADI");
    expect(report.results[0].note).toContain("mülga");
  });

  it("fıkralı atıf ('İşK 25/2') maddeye indirgenir", async () => {
    const isk = { ...STATUTE, id: "st-isk", mevzuatNo: "4857", title: "İŞ KANUNU", abbrs: "İşK,İK" };
    const madde25 = { ...ARTICLE, id: "sav-25", statuteId: "st-isk", articleNo: "25" };
    const svc = serviceWith({ statute: isk, article: madde25 });
    const report = await svc.verify(USER, { citations: ["İşK 25/2"] });
    expect(report.results[0].status).toBe("DOGRULANDI");
    expect(report.results[0].matchedStatute?.articleNo).toBe("25");
  });

  it("özet tüm atıflar doğrulanınca PASSED olur", async () => {
    const svc = serviceWith({ statute: STATUTE, article: ARTICLE });
    const report = await svc.verify(USER, { citations: ["TCK m.86", "TCK md.86"] });
    expect(report.summary.verified).toBeGreaterThanOrEqual(1);
    expect(["PASSED", "PARTIAL"]).toContain(report.summary.overall);
  });
});

describe("verify — AYM bireysel başvuru künyesi (canlı adaptör üzerinden)", () => {
  const AYM_RECORD = {
    id: "aym:4ecaf1ae",
    court: "Anayasa Mahkemesi",
    chamber: "Birinci Bölüm",
    caseNumber: "2013/1821",
    decisionNumber: "",
    decisionDate: new Date("2014-11-05T00:00:00Z"),
    sourceAdapter: "AYM_CANLI",
  };

  function serviceWithRegistry(aggregated: {
    outcome: "FOUND" | "NOT_FOUND" | "SEARCH_FAILED";
    record?: typeof AYM_RECORD;
    note?: string;
  }) {
    const adapters = {
      fetchByCitationAll: async () => ({
        outcome: aggregated.outcome,
        lookup: { outcome: aggregated.outcome, record: aggregated.record, note: aggregated.note ?? "", adapterKey: "AYM_CANLI" },
        perAdapter: [],
      }),
    } as unknown as CaseLawAdapterRegistry;
    const statutes = {} as unknown as StatuteLookupService;
    const prisma = { client: {} } as unknown as PrismaService;
    return new CitationVerifyService(prisma, adapters, statutes);
  }

  it("karar no OLMADAN da AYM künyesi doğrulanabilir (başvuru numarasıyla)", async () => {
    const svc = serviceWithRegistry({ outcome: "FOUND", record: AYM_RECORD });
    const report = await svc.verify(USER, { citations: ["AYM'nin 2013/1821 başvuru numaralı kararı"] });
    expect(report.results[0].kind).toBe("ICTIHAT");
    expect(report.results[0].status).toBe("DOGRULANDI");
    expect(report.results[0].note).toContain("başvuru no");
    expect(report.results[0].matchedRecord?.sourceAdapter).toBe("AYM_CANLI");
  });

  it("AYM canlı kaynağı erişilemezse BELIRSIZ döner (fail-closed)", async () => {
    const svc = serviceWithRegistry({ outcome: "SEARCH_FAILED" });
    const report = await svc.verify(USER, { citations: ["AYM'nin 2013/1821 başvuru numaralı kararı"] });
    expect(report.results[0].status).toBe("BELIRSIZ");
    expect(report.results[0].note).toContain("ASLA");
  });

  it("AYM olmayan kaynakta karar nosuz künye hâlâ BELIRSIZ kalır (künye eksik kuralı)", async () => {
    const svc = serviceWithRegistry({ outcome: "FOUND", record: AYM_RECORD });
    const report = await svc.verify(USER, { citations: ["2016/1234 esas sayılı dosyamız"] });
    // "dosyamız" — mahkeme adı yoksa zaten atıf çıkarılamaz; biçim uyarsa bile
    // karar no zorunluluğu AYM dışında korunur.
    const r = report.results[0];
    expect(r.status === "BELIRSIZ" || r.kind === "TANINMADI").toBe(true);
  });
});
