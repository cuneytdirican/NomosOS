/**
 * E6 REGRESYON TESTİ — delil matrisinde bağ YÖNÜ (Ö-30 kullanım ayağı).
 *
 * Denetimde DOĞRULANAN hata: `ClaimEvidenceLink.linkType` şemada vardı ama
 * HİÇBİR YERDE OKUNMUYORDU; matris `counted.length === 0` ile desteksizlik
 * kararını veriyordu. Sonuç: yalnızca ÇÜRÜTEN delil bağı olan bir iddia
 * "desteklenmiş" sayılıyordu (Modül 14 KK3 yanlış sonuç).
 *
 * Bu test yön-farkında hesabı korur: SUPPORTS taşır, CONTRADICTS taşımaz ve
 * iddiayı çürütülmüş işaretler, BELIRSIZ taşımaz.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EvidenceMatrixService } from "./evidence-matrix.service";

/* ------------------------------------------------------------------ *
 * Stub Prisma — compute() yalnız üç sorgu yapar.
 * ------------------------------------------------------------------ */

interface StubClaim {
  id: string;
  side: string;
  status: string;
  text: string;
  orderIndex: number;
  evidenceLinks: {
    id: string;
    evidenceId: string;
    linkType: string;
    strength: number | null;
    note: string | null;
    evidence: { id: string; status: string; title: string; type: string; documentId: null; witnessName: null };
  }[];
  legalBases: [];
}

function stubClaim(
  over: Partial<StubClaim> & { evidenceLinks: StubClaim["evidenceLinks"] },
): StubClaim {
  const base: StubClaim = {
    id: "c1",
    side: "BIZ",
    status: "ACIK",
    text: "İddia metni",
    orderIndex: 0,
    evidenceLinks: over.evidenceLinks,
    legalBases: [],
  };
  return { ...base, ...over, evidenceLinks: over.evidenceLinks };
}

function link(id: string, linkType: string, evidenceStatus = "TOPLANDI", strength: number | null = 4) {
  return {
    id,
    evidenceId: `ev-${id}`,
    linkType,
    strength,
    note: null,
    evidence: {
      id: `ev-${id}`,
      status: evidenceStatus,
      title: `Delil ${id}`,
      type: "BELGE",
      documentId: null,
      witnessName: null,
    },
  };
}

function serviceWith(claims: StubClaim[]) {
  const prisma = {
    client: {
      case: { findFirst: async () => ({ id: "k1", title: "T", fileNumber: "2026/1", status: "DEVAM", type: "DAVA" }) },
      claim: { findMany: async () => claims },
      evidence: { findMany: async () => [] },
      document: { findMany: async () => [] },
    },
  };
  return new EvidenceMatrixService(prisma as never);
}

describe("E6: bağ yönü matris hesabına girer (Ö-30 kullanım ayağı)", () => {
  it("yalnızca CONTRADICTS bağı olan BİZ iddiası desteksiz VE çürütülmüştür", async () => {
    // Denetimin doğruladığı hata: bu iddia eskiden "desteklenmiş" görünüyordu.
    const svc = serviceWith([
      stubClaim({ id: "c1", evidenceLinks: [link("l1", "CONTRADICTS")] }),
    ]);
    const computed = await svc.compute("t1", "k1");
    const row = computed.rows[0];
    expect(row.unsupported).toBe(true);
    expect(row.contradicted).toBe(true);
    expect(row.supportingCount).toBe(0);
    expect(row.contradictingCount).toBe(1);
    expect(computed.summary.contradictedCount).toBe(1);
    expect(computed.summary.unsupportedCount).toBe(1);
  });

  it("SUPPORTS + CONTRADICTS karışımı: destek sayılır VE çürüten görünür", async () => {
    const svc = serviceWith([
      stubClaim({
        id: "c1",
        evidenceLinks: [link("l1", "SUPPORTS", "TOPLANDI", 4), link("l2", "CONTRADICTS")],
      }),
    ]);
    const row = (await svc.compute("t1", "k1")).rows[0];
    expect(row.unsupported).toBe(false);
    expect(row.supportingCount).toBe(1);
    expect(row.contradictingCount).toBe(1);
    expect(row.contradicted).toBe(true);
    expect(row.strongestStrength).toBe(4);
  });

  it("BELIRSIZ bağı destek SAYMAZ — yön belirsizse iddia taşınmamıştır", async () => {
    const svc = serviceWith([
      stubClaim({ id: "c1", evidenceLinks: [link("l1", "BELIRSIZ")] }),
    ]);
    const row = (await svc.compute("t1", "k1")).rows[0];
    expect(row.unsupported).toBe(true);
    expect(row.supportingCount).toBe(0);
    expect(row.contradicted).toBe(false);
  });

  it("REDdelinen delil hangi yönden gelirse gelsin hesaba girmez", async () => {
    const svc = serviceWith([
      stubClaim({
        id: "c1",
        evidenceLinks: [link("l1", "SUPPORTS", "RED"), link("l2", "CONTRADICTS", "RED")],
      }),
    ]);
    const row = (await svc.compute("t1", "k1")).rows[0];
    expect(row.unsupported).toBe(true);
    expect(row.contradicted).toBe(false);
  });

  it("çürütülen bayrağı yalnız BİZ iddiaları için üretilebilir", async () => {
    const svc = serviceWith([
      stubClaim({ id: "c1", side: "KARSI_TARAF", evidenceLinks: [link("l1", "CONTRADICTS")] }),
    ]);
    const row = (await svc.compute("t1", "k1")).rows[0];
    expect(row.contradicted).toBe(false);
    expect(row.unsupported).toBe(false); // karşı tarafın ispatsızlığı bizim riskimiz değil
  });

  it("matris satırları bağın yönünü döndürüyor (arayüz gösterebilir)", async () => {
    const svc = serviceWith([
      stubClaim({ id: "c1", evidenceLinks: [link("l1", "CONTRADICTS")] }),
    ]);
    const row = (await svc.compute("t1", "k1")).rows[0];
    expect(row.evidence[0].linkType).toBe("CONTRADICTS");
  });
});

describe("E6: bağ kurma yolu yönü kayda yazıyor", () => {
  it("linkEvidence linkType alanını kalıcılaştırıyor (kaynak taahhüdü)", () => {
    const src = readFileSync(`${process.cwd()}/src/evidence/evidence.service.ts`, "utf-8");
    expect(src).toContain('linkType: input.linkType ?? "SUPPORTS"');
    expect(src).toContain("yön=${input.linkType ??");
  });

  it("tanım sözlüğü çürütülen ve yön açıklamalarını taşıyor", () => {
    const src = readFileSync(`${process.cwd()}/src/evidence/evidence-matrix.service.ts`, "utf-8");
    expect(src).toContain("contradicted:");
    expect(src).toContain("linkTypes:");
    expect(src).toContain("CONTRADICTS bağı taşımaz");
  });
});

describe("E6/KK6: delil tarafı (offeredBy) ve tutarlılık kapısı", () => {
  // readFileSync zaten dosya başında içe aktarıldı; require kullanılmaz.
  const service = readFileSync(`${process.cwd()}/src/evidence/evidence.service.ts`, "utf-8");
  const dto = readFileSync(`${process.cwd()}/src/evidence/evidence.dto.ts`, "utf-8");

  it("KK6: BİZ iddiası + BİZ delili + CONTRADICTS → 422 reddi kodda var", () => {
    expect(service).toContain('claim.side === "BIZ"');
    expect(service).toContain('(input.linkType ?? "SUPPORTS") === "CONTRADICTS"');
    expect(service).toContain('evidence.offeredBy !== "KARSI_TARAF"');
    expect(service).toContain("UnprocessableEntityException");
  });

  it("KK6 (F2-Ö-10): CONTRADICTS yalnız KARSI_TARAF deliline kurulabilir", () => {
    // Kapı artık 'BIZ' değil '!KARSI_TARAF' ile kapanır (spec'in 5. kuralı).
    expect(service).not.toContain('evidence.offeredBy === "BIZ"');
    expect(service).toContain('evidence.offeredBy !== "KARSI_TARAF"');
  });

  it("offeredBy hem oluşturmada hem güncellemede kabul edilir", () => {
    expect(service).toContain("offeredBy: input.offeredBy ?? null");
    expect(service).toContain("{ offeredBy: input.offeredBy ?? null }");
    expect(dto).toContain("offeredBy: z.enum(EVIDENCE_SIDES");
  });

  it("EVIDENCE_SIDES kataloğu Prisma enum'uyla birebir", () => {
    expect(dto).toContain(
      'export const EVIDENCE_SIDES = ["BIZ", "KARSI_TARAF", "ORTAK"] as const;',
    );
  });

  it("şema: Evidence.offeredBy nullable — göç eski kayıtlara varsayım basmaz", () => {
    const schema = readFileSync(
      `${process.cwd()}/../../packages/db/prisma/schema.prisma`,
      "utf-8",
    );
    expect(schema).toMatch(/offeredBy\s+EvidenceSide\?/);
    expect(schema).toContain("enum EvidenceSide");
  });
});
