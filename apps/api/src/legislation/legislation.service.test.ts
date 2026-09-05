/**
 * MEVZUAT KÜTÜPHANESİ — KİRACI İZOLASYONU TESTLERİ.
 *
 * Korunan taahhüt: liste/arama sorgusu HER ZAMAN "bu büro + platform
 * (tenantId=null)" görünürlük süzgecini taşır. Regresyon kaynağı: Prisma
 * `where` nesnesinde görünürlük `OR`'u ile arama `OR`'u aynı anahtarı
 * paylaşırsa ikincisi birincisini EZER ve arama yapıldığında diğer büroların
 * kayıtları görünür olur. Bu testler `where`'i sahte Prisma üzerinden
 * yakalayıp Prisma semantiğini (AND/OR) satır kümesine uygulayarak sızıntıyı
 * ölçer.
 */

import { describe, expect, it, vi } from "vitest";
import { LegislationService } from "./legislation.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";

type Row = {
  id: string;
  tenantId: string | null;
  isActive: boolean;
  docType: string;
  title: string;
  fullText: string;
  number: string | null;
  tags: string | null;
  year: number | null;
  enactedAt: Date | null;
  versionNote: string | null;
  sourceKey: string | null;
  rgDate: Date | null;
  rgNo: string | null;
  createdAt: Date;
  updatedAt: Date;
  preview: string;
};

const ROWS: Row[] = [
  row("a-1", "buro-A", "İş Kanunu (büro A yüklemesi)", "kıdem tazminatı hesabı"),
  row("b-1", "buro-B", "Kira Kanunu (büro B yüklemesi)", "kıdem ve kira artışı"),
  row("p-1", null, "TÜRK CEZA KANUNU", "kıdem sözcüğü platform metninde de geçer"),
  row("p-2", null, "HUKUK MUHAKEMELERİ KANUNU", "yargılama usulü"),
];

function row(id: string, tenantId: string | null, title: string, fullText: string): Row {
  return {
    id,
    tenantId,
    isActive: true,
    docType: "KANUN",
    title,
    fullText,
    number: null,
    tags: null,
    year: 2020,
    enactedAt: null,
    versionNote: null,
    sourceKey: tenantId === null ? "MEVZUAT_GOV" : null,
    rgDate: null,
    rgNo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    preview: fullText,
  };
}

/**
 * Prisma `where` semantiğinin bu testte kullanılan alt kümesi:
 * skaler eşitlik, `contains` (insensitive), `AND`, `OR`. Amaç sorgunun
 * gerçekten hangi satırları döndüreceğini ölçmek — nesne yapısını değil.
 */
function matches(where: Record<string, unknown>, r: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      if (!(cond as Record<string, unknown>[]).every((c) => matches(c, r))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((c) => matches(c, r))) return false;
      continue;
    }
    const value = (r as unknown as Record<string, unknown>)[key];
    if (cond !== null && typeof cond === "object" && "contains" in (cond as object)) {
      const needle = String((cond as { contains: string }).contains).toLocaleLowerCase("tr-TR");
      if (typeof value !== "string" || !value.toLocaleLowerCase("tr-TR").includes(needle)) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function build() {
  const findMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    ROWS.filter((r) => matches(where, r)),
  );
  const prisma = { client: { legislation: { findMany } } } as unknown as PrismaService;
  const audit = { log: vi.fn(async () => undefined) } as unknown as AuditService;
  return { service: new LegislationService(prisma, audit), findMany };
}

const userA = { tenantId: "buro-A", userId: "u-a", role: "AVUKAT" } as unknown as AuthUser;

describe("LegislationService.list — kiracı izolasyonu", () => {
  it("aramasız liste: büronun kendi kayıtları + platform kayıtları, başka büro YOK", async () => {
    const { service } = build();
    const ids = (await service.list(userA, {})).map((r) => r.id).sort();
    expect(ids).toEqual(["a-1", "p-1", "p-2"]);
  });

  it("ARAMALI liste kiracı süzgecini KORUR — 'kıdem' aramasında büro B'nin kaydı sızmaz", async () => {
    const { service } = build();
    const ids = (await service.list(userA, { q: "kıdem" })).map((r) => r.id).sort();
    // b-1 de 'kıdem' içerir; görünmemesi izolasyonun kanıtıdır.
    expect(ids).toEqual(["a-1", "p-1"]);
  });

  it("arama + belge türü süzgeci birlikte de izolasyonu korur", async () => {
    const { service } = build();
    const ids = (await service.list(userA, { q: "kıdem", docType: "KANUN" })).map((r) => r.id).sort();
    expect(ids).toEqual(["a-1", "p-1"]);
  });

  it("platform kaydı isPlatform=true, büro kaydı false ile işaretlenir", async () => {
    const { service } = build();
    const rows = await service.list(userA, {});
    expect(rows.find((r) => r.id === "p-1")?.isPlatform).toBe(true);
    expect(rows.find((r) => r.id === "a-1")?.isPlatform).toBe(false);
  });

  it("where nesnesi görünürlük OR'unu AND altında taşır (aynı anahtarın ezilmesi yapısal olarak imkânsız)", async () => {
    const { service, findMany } = build();
    await service.list(userA, { q: "x" });
    const where = findMany.mock.calls[0][0].where as { AND?: unknown[]; OR?: unknown };
    expect(Array.isArray(where.AND)).toBe(true);
    expect(where.OR).toBeUndefined();
    expect(JSON.stringify(where)).toContain('"tenantId":"buro-A"');
    expect(JSON.stringify(where)).toContain('"tenantId":null');
  });
});
