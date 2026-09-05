/**
 * FAZ 7B — global arama.
 *
 *  1. Kısa sorgu (< 2) hiç sorgu atmaz.
 *  2. Türkçe varyant: "Icra" → "İcra"/"ıcra"/"icra" hepsi OR'a girer.
 *  3. Görünürlük: AVUKAT için dosya sorgusuna gizlilik OR'u eklenir; ADMIN'e eklenmez.
 *  4. Boş gruplar atılır; her sonuç href taşır.
 */

import { describe, expect, it, vi } from "vitest";
import { SearchService, queryVariants } from "./search.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/types";

const AVUKAT = { userId: "u-1", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;
const ADMIN = { userId: "u-0", tenantId: "buro-A", role: "ADMIN" } as AuthUser;

function harness() {
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string, rows: unknown[]) => ({
    findMany: vi.fn(async (args: unknown) => {
      (calls[name] ??= []).push(args);
      return rows;
    }),
  });
  const client = {
    case: rec("case", [{ id: "c1", title: "İcra takibi", fileNumber: "2026/8841", courtName: "Ankara 7. İcra Dairesi", status: "ACIK", client: { name: "Kuzey Yapı" } }]),
    client: rec("client", []),
    document: rec("document", [{ id: "d1", name: "İcra emri.pdf", class: "ICRA_EVRAKI", caseId: "c1", case: { fileNumber: "2026/8841", title: "İcra takibi" } }]),
    task: rec("task", []),
    deadline: rec("deadline", []),
    hearing: rec("hearing", []),
    petition: rec("petition", []),
  };
  return { svc: new SearchService({ client } as unknown as PrismaService), calls, client };
}

describe("Faz 7B: queryVariants", () => {
  it("İ/ı katlaması", () => {
    expect(queryVariants("Icra")).toEqual(["Icra", "ıcra", "icra"]);
    expect(queryVariants("İCRA")).toEqual(["İCRA", "iCRA"]);
    expect(queryVariants("  ")).toEqual([]);
  });
});

describe("Faz 7B: SearchService", () => {
  it("kısa sorgu sorgu atmaz", async () => {
    const h = harness();
    expect(await h.svc.search(AVUKAT, "a")).toEqual({ query: "a", groups: [], total: 0 });
    expect(h.client.case.findMany).not.toHaveBeenCalled();
  });

  it("gruplar href taşır, boş gruplar atılır, limit 10'a kırpılır", async () => {
    const h = harness();
    const res = await h.svc.search(AVUKAT, "Icra", 50);
    expect(res.total).toBe(2);
    expect(res.groups.map((g) => g.kind)).toEqual(["DOSYA", "BELGE"]);
    expect(res.groups[0].items[0]).toMatchObject({ title: "2026/8841 — İcra takibi", href: "/app/dosyalar/c1" });
    expect(res.groups[1].items[0].href).toContain("sekme=belgeler&belge=d1");
    expect((h.calls.case[0] as { take: number }).take).toBe(10);
    // Görünürlük OR'u ile arama OR'u AND altında ayrı nesnelerdedir (çift-OR sızıntısı yok).
    const where = (h.calls.case[0] as { where: { AND: Array<{ OR?: Array<Record<string, { contains: string }>> }> } }).where;
    const or = where.AND[1].OR ?? [];
    expect(or.some((o) => o.title?.contains === "ıcra")).toBe(true);
    expect(or.some((o) => o.title?.contains === "icra")).toBe(true);
  });

  it("görünürlük: AVUKAT'a gizlilik süzgeci eklenir, ADMIN'e eklenmez", async () => {
    const h = harness();
    await h.svc.search(AVUKAT, "icra");
    const whereAvukat = (h.calls.case[0] as { where: Record<string, unknown> }).where;
    expect(JSON.stringify(whereAvukat)).toContain("isConfidential");
    const whereDoc = (h.calls.document[0] as { where: Record<string, unknown> }).where;
    expect(JSON.stringify(whereDoc)).toContain("caseId");
    expect(whereDoc).toMatchObject({ deletedAt: null, supersededAt: null });
    const h2 = harness();
    await h2.svc.search(ADMIN, "icra");
    expect(JSON.stringify((h2.calls.case[0] as { where: unknown }).where)).not.toContain("isConfidential");
  });
});
