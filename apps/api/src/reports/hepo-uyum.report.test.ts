/**
 * HEPO UYUM RAPORU TESTLERİ (Modül 28 Faz 4).
 *
 * Korunan taahhütler:
 *  1. Fotoğraf referans anı DÖNEMİN SON GÜNÜDÜR — referans günü geçmiş ve
 *     UYGUN olmayan kayıt "vadesi geçen" sayılır.
 *  2. UYGUN işaretli kayıt vadesi geçmiş olsa bile "geçen" sayılmaz.
 *  3. Uyum oranı paydası o müvekkilin TÜM atamalarıdır.
 *  4. Kiracı izolasyonu sorguda tenantId ile; müvekkil daraltması (clientId)
 *     WHERE'e iner.
 *  5. Vadesi geçenler tablosu gecikme gününü referans güne göre hesaplar.
 */

import { describe, expect, it } from "vitest";
import { hepoUyumReport } from "./builders/hepo-uyum.report";
import type { ReportContext, ResolvedReportParams } from "./report-types";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/types";

interface FakeRow {
  id: string;
  status: string;
  dueDate: Date | null;
  obligation: { topic: string; title: string; legalBasis: string };
  client: { id: string; name: string };
}

function paramsOver(over?: Partial<ResolvedReportParams>): ResolvedReportParams {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const to = new Date("2026-12-31T00:00:00.000Z");
  return {
    period: { from, to, endExclusive: new Date("2027-01-01T00:00:00.000Z"), days: 365, preset: "OZEL", label: "01.01.2026 – 31.12.2026 (bitiş dâhil)", endInclusive: true },
    limit: 500,
    agingBuckets: [30, 60, 90],
    raw: {},
    ...over,
  };
}

function ctxOver(rows: FakeRow[], over?: { params?: Partial<ResolvedReportParams>; user?: Partial<AuthUser> }): ReportContext {
  let capturedWhere: Record<string, unknown> | null = null;
  const prisma = {
    client: {
      hepoClientObligation: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          capturedWhere = args.where;
          // Kiracı izolasyonu ve müvekkil süzgeci sahte üzerinde AYNEN uygulanır.
          const tenantId = args.where.tenantId as string;
          const clientId = args.where.clientId as string | undefined;
          return rows.filter(
            (r) =>
              (!clientId || r.client.id === clientId) &&
              // tenantId satırda yok (tek kiracı kurgusu); yalnız süzgecin
              // taşındığını doğrulamak için kaydediyoruz.
              tenantId === "tenant-a",
          );
        },
      },
    },
  } as unknown as PrismaService;
  const ctx = {
    user: { userId: "u-1", tenantId: "tenant-a", role: "ADMIN", ...over?.user } as AuthUser,
    prisma,
    params: paramsOver(over?.params),
    now: new Date("2026-12-31T09:00:00.000Z"),
  };
  return Object.assign(ctx, { _captured: { get where() { return capturedWhere; } } }) as unknown as ReportContext & { _captured: { where: Record<string, unknown> | null } };
}

const OBL = {
  ISG: { topic: "ISG", title: "Risk değerlendirmesi", legalBasis: "6331 s.k. m.10" },
  CEVRE: { topic: "CEVRE", title: "Tehlikeli atık beyanı", legalBasis: "Atık Yön." },
};

describe("hepo-uyum raporu", () => {
  it("UYGUN olmayan ve vadesi geçmiş kayıt 'geçen' sayılır; UYGUN kayıt sayılmaz", async () => {
    const rows: FakeRow[] = [
      // Vadesi 2026-06-01'de geçti, hâlâ ACIK → geçen.
      { id: "r1", status: "ACIK", dueDate: new Date("2026-06-01T00:00:00.000Z"), obligation: OBL.ISG, client: { id: "c1", name: "A Şti." } },
      // Vadesi geçti AMA UYGUN → geçen DEĞİL, uyumlu.
      { id: "r2", status: "UYGUN", dueDate: new Date("2026-05-01T00:00:00.000Z"), obligation: OBL.CEVRE, client: { id: "c1", name: "A Şti." } },
      // Vadesi gelecekte, açık → geçen değil.
      { id: "r3", status: "ACIK", dueDate: new Date("2027-03-01T00:00:00.000Z"), obligation: OBL.ISG, client: { id: "c2", name: "B A.Ş." } },
      // İhlal, vadesi geçmiş.
      { id: "r4", status: "IHLAL", dueDate: new Date("2026-02-01T00:00:00.000Z"), obligation: OBL.CEVRE, client: { id: "c2", name: "B A.Ş." } },
    ];
    const ctx = ctxOver(rows);
    const body = await hepoUyumReport(ctx);

    const toplam = body.metrics?.find((m) => m.key === "toplam");
    const uyumlu = body.metrics?.find((m) => m.key === "uyumlu");
    const gecen = body.metrics?.find((m) => m.key === "gecen");
    const ihlal = body.metrics?.find((m) => m.key === "ihlal");
    expect(toplam?.value).toBe(4);
    expect(uyumlu?.value).toBe(1);
    expect(gecen?.value).toBe(2); // r1 + r4 (r2 UYGUN)
    expect(ihlal?.value).toBe(1);
    expect(gecen?.critical).toBe(true);
  });

  it("müvekkil kırılımında uyum oranı payda o müvekkilin tüm atamalarıdır", async () => {
    const rows: FakeRow[] = [
      { id: "r1", status: "UYGUN", dueDate: null, obligation: OBL.ISG, client: { id: "c1", name: "A Şti." } },
      { id: "r2", status: "UYGUN", dueDate: null, obligation: OBL.CEVRE, client: { id: "c1", name: "A Şti." } },
      { id: "r3", status: "ACIK", dueDate: new Date("2026-03-01T00:00:00.000Z"), obligation: OBL.ISG, client: { id: "c1", name: "A Şti." } },
      { id: "r4", status: "UYGUN", dueDate: null, obligation: OBL.CEVRE, client: { id: "c2", name: "B A.Ş." } },
    ];
    const body = await hepoUyumReport(ctxOver(rows));
    const muvekkil = body.tables.find((t) => t.key === "muvekkil");
    const a = muvekkil?.rows.find((r) => String(r.muvekkil).startsWith("A Şti."));
    const b = muvekkil?.rows.find((r) => String(r.muvekkil).startsWith("B A.Ş."));
    expect(a?.uyumOrani).toBeCloseTo(66.67, 1); // 2/3
    expect(b?.uyumOrani).toBe(100);
  });

  it("vadesi geçenler tablosu gecikme gününü referans güne göre hesaplar", async () => {
    const rows: FakeRow[] = [
      { id: "r1", status: "ACIK", dueDate: new Date("2026-12-01T00:00:00.000Z"), obligation: OBL.ISG, client: { id: "c1", name: "A Şti." } },
    ];
    const body = await hepoUyumReport(ctxOver(rows));
    const gecen = body.tables.find((t) => t.key === "vadesi-gecen");
    expect(gecen?.rows).toHaveLength(1);
    expect(gecen?.rows[0].gecGun).toBe(30); // 01.12 → 31.12
    expect(gecen?.rows[0].vade).toBe("2026-12-01");
  });

  it("müvekkil daraltması WHERE'e girer (clientId)", async () => {
    const rows: FakeRow[] = [
      { id: "r1", status: "ACIK", dueDate: null, obligation: OBL.ISG, client: { id: "c1", name: "A Şti." } },
    ];
    const ctx = ctxOver(rows, { params: { clientId: "c1" } as Partial<ResolvedReportParams> });
    await hepoUyumReport(ctx);
    const where = (ctx as unknown as { _captured: { where: Record<string, unknown> | null } })._captured.where;
    expect(where?.tenantId).toBe("tenant-a");
    expect(where?.clientId).toBe("c1");
  });

  it("boş havuzda sıfır ölçüler ve boş tablolar döner (uydurma yok)", async () => {
    const body = await hepoUyumReport(ctxOver([]));
    expect(body.metrics?.find((m) => m.key === "toplam")?.value).toBe(0);
    for (const t of body.tables) expect(t.rows).toHaveLength(0);
  });
});
