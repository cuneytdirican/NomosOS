/**
 * CITATION_VERIFY — MAHKEME UYUM KAPISI TESTLERİ.
 *
 * Korunan taahhüt: künye bir mahkemeyi adlandırıyorsa (Yargıtay), eşleşen
 * kayıt başka bir mahkemenin kararı (Anayasa Mahkemesi) olamaz — adaptör ne
 * dönerse dönsün servis katmanı yeniden denetler ve DOGRULANDI ÜRETMEZ.
 * Aksi hâlde aynı esas/karar numaralı bir AYM kararı, uydurma bir Yargıtay
 * atfını teyit kapısından geçirebilirdi (fail-closed ihlali).
 */

import { describe, expect, it } from "vitest";
import { CitationVerifyService } from "./citation-verify.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { CaseLawAdapterRegistry } from "./adapters/registry.service";
import type { StatuteLookupService } from "../legislation/statute-lookup.service";
import type { AuthUser } from "../common/types";
import type { CaseLawDocument } from "@nomosos/db";

const USER: AuthUser = { userId: "u-1", tenantId: "t-1" } as AuthUser;

function record(court: string, chamber: string | null = null): CaseLawDocument {
  return {
    id: `rec-${court}`,
    court,
    chamber,
    caseNumber: "2015/1234",
    decisionNumber: "2016/5678",
    decisionDate: new Date("2016-05-01T00:00:00Z"),
    summary: null,
    fullText: null,
    sourceUrl: null,
    sourceAdapter: "AYM_CANLI",
    fetchedAt: new Date(),
    createdByTenantId: null,
  } as unknown as CaseLawDocument;
}

function serviceReturning(rec: CaseLawDocument) {
  let lastQuery: unknown = null;
  const adapters = {
    fetchByCitationAll: async (q: unknown) => {
      lastQuery = q;
      return {
        outcome: "FOUND",
        lookup: { outcome: "FOUND", adapterKey: rec.sourceAdapter, note: "", record: rec },
        perAdapter: [{ outcome: "FOUND", adapterKey: rec.sourceAdapter, note: "", record: rec }],
      };
    },
  } as unknown as CaseLawAdapterRegistry;
  const statutes = { findArticle: async () => null, findStatute: async () => null } as unknown as StatuteLookupService;
  const prisma = { client: {} } as unknown as PrismaService;
  return { svc: new CitationVerifyService(prisma, adapters, statutes), lastQuery: () => lastQuery };
}

describe("verify — mahkeme uyum kapısı", () => {
  it("Yargıtay künyesi, Anayasa Mahkemesi kaydıyla DOGRULANDI olamaz → BELIRSIZ", async () => {
    const { svc, lastQuery } = serviceReturning(record("Anayasa Mahkemesi"));
    const report = await svc.verify(USER, { citations: ["Yargıtay 2015/1234 E. 2016/5678 K."] });
    const r = report.results[0];
    expect(r.kind).toBe("ICTIHAT");
    expect(r.status).toBe("BELIRSIZ");
    expect(r.note).toContain("uyuşmuyor");
    // Kaynak künyeden adaptörlere iletilmiştir (kaynak kapısı bunu okur).
    expect((lastQuery() as { source?: string }).source).toBe("YARGITAY");
  });

  it("Yargıtay künyesi Yargıtay kaydıyla eşleşirse DOGRULANDI", async () => {
    const { svc } = serviceReturning(record("Yargıtay 9. Hukuk Dairesi", "9. Hukuk Dairesi"));
    const report = await svc.verify(USER, { citations: ["Yargıtay 9. HD 2015/1234 E. 2016/5678 K."] });
    expect(report.results[0].status).toBe("DOGRULANDI");
  });

  it("AYM künyesi AYM kaydıyla eşleşirse DOGRULANDI (kapı yanlış pozitif üretmez)", async () => {
    const { svc } = serviceReturning(record("Anayasa Mahkemesi"));
    const report = await svc.verify(USER, { citations: ["Anayasa Mahkemesi 2015/1234 E. 2016/5678 K."] });
    expect(report.results[0].status).toBe("DOGRULANDI");
  });
});
