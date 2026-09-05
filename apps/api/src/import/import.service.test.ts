/**
 * FAZ 8E — veri göçü.
 *  1. CSV ayrıştırıcı: ayırıcı otomatik, tırnak, BOM, Türkçe başlık normalizasyonu, tarih biçimleri.
 *  2. Dosya önizlemesi yazmaz; mevcut esas no ATLA, geçersiz tür HATA, bilinmeyen müvekkil "oluşturulacak".
 *  3. Çalıştırma: müvekkil oluşturur, dosya yazar; duruşmada geçmiş tarih → YAPILDI, aynı gün mükerrer ATLA.
 *  4. Rol kapısı: AVUKAT önizleyemez (403).
 */

import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { ImportService } from "./import.service";
import { normalizeHeader, parseCsv, parseTrDate } from "./csv";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { DocumentsService } from "../documents/documents.service";
import type { AuthUser } from "../common/types";

const PARTNER = { userId: "u-p", tenantId: "buro-A", role: "PARTNER" } as AuthUser;
const AVUKAT = { userId: "u-a", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;

describe("Faz 8E: CSV ayrıştırıcı", () => {
  it("ayırıcı, tırnak, BOM, başlık normalizasyonu", () => {
    const p = parseCsv('\uFEFFMüvekkil;Başlık;"Esas No"\r\n"Ayşe; Yılmaz";İşe iade;2025/12\r\n');
    expect(p.delimiter).toBe(";");
    expect(p.normalizedHeaders).toEqual(["muvekkil", "baslik", "esas_no"]);
    expect(p.rows[0]).toEqual(["Ayşe; Yılmaz", "İşe iade", "2025/12"]);
    expect(parseCsv("a,b\n1,2").delimiter).toBe(",");
    expect(normalizeHeader("Duruşma Tarihi")).toBe("durusma_tarihi");
  });

  it("tarih biçimleri", () => {
    expect(parseTrDate("12.03.2026 09:30")?.toISOString()).toBe("2026-03-12T09:30:00.000Z");
    expect(parseTrDate("12/03/2026")?.toISOString()).toBe("2026-03-12T09:00:00.000Z");
    expect(parseTrDate("2026-03-12T14:00")?.toISOString()).toBe("2026-03-12T14:00:00.000Z");
    expect(parseTrDate("yarın")).toBeNull();
  });
});

function harness() {
  const clients = [{ id: "c-1", name: "Ayşe Yılmaz" }];
  const cases = [{ id: "k-1", title: "Mevcut dosya", fileNumber: "2024/1" }];
  const hearings: { caseId: string; date: Date; status: string }[] = [{ caseId: "k-1", date: new Date("2026-05-05T09:00:00Z"), status: "PLANLANDI" }];
  const created: Record<string, unknown[]> = { client: [], case: [], hearing: [] };
  const client = {
    client: {
      findMany: vi.fn(async () => clients),
      create: vi.fn(async ({ data }: { data: { name: string } }) => {
        const c = { id: `c-${clients.length + 1}`, name: data.name };
        clients.push(c);
        created.client.push(data);
        return c;
      }),
    },
    user: { findMany: vi.fn(async () => [{ id: "u-av", email: "av@buro.tr" }]) },
    case: {
      findMany: vi.fn(async () => cases),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.case.push(data);
        return { id: `k-${cases.length + 1}` };
      }),
    },
    hearing: {
      findMany: vi.fn(async () => hearings),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.hearing.push(data);
        return data;
      }),
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  const docs = { upload: vi.fn() };
  return { svc: new ImportService({ client } as unknown as PrismaService, audit as unknown as AuditService, docs as unknown as DocumentsService), created, audit };
}

describe("Faz 8E: dosya göçü", () => {
  const CSV = ["muvekkil;baslik;tur;durum;mahkeme;esas_no;sorumlu_eposta", "Ayşe Yılmaz;Yılmaz işe iade;DAVA;DERDEST;İstanbul 12. İş;2025/10;av@buro.tr", "Mehmet Kaya;Kaya alacak;ICRA;;Ankara 4. İcra;2025/11;yok@buro.tr", "X;Mevcut;DAVA;;;2024/1;", "Y;Bozuk;TAKIP;;;;"].join("\n");

  it("önizleme yazmaz: EKLE/ATLA/HATA + notlar", async () => {
    const h = harness();
    const p = await h.svc.preview(PARTNER, { kind: "dosyalar", csv: CSV });
    expect(p).toMatchObject({ total: 4, ekle: 2, atla: 1, hata: 1, missingRequired: [] });
    expect(p.rows[1].notes.join(" ")).toMatch(/Mehmet Kaya.*oluşturulacak/);
    expect(p.rows[1].notes.join(" ")).toMatch(/yok@buro.tr/);
    expect(p.rows[2]).toMatchObject({ action: "ATLA" });
    expect(p.rows[3].notes[0]).toMatch(/geçersiz tür: TAKIP/);
    expect(h.created.case).toHaveLength(0);
    expect(h.created.client).toHaveLength(0);
  });

  it("çalıştırma: müvekkil oluşturur, dosyaları yazar, denetime yazar", async () => {
    const h = harness();
    const r = await h.svc.run(PARTNER, { kind: "dosyalar", csv: CSV });
    expect(r).toMatchObject({ created: 2, failed: 0 });
    expect(h.created.client).toEqual([{ tenantId: "buro-A", type: "GERCEK_KISI", name: "Mehmet Kaya" }]);
    expect(h.created.case[0]).toMatchObject({ clientId: "c-1", status: "DERDEST", fileNumber: "2025/10", responsibleUserId: "u-av" });
    expect(h.created.case[1]).toMatchObject({ clientId: "c-2", type: "ICRA", status: "ACIK", responsibleUserId: null });
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "DATA_IMPORT" }));
  });

  it("avukat 403", async () => {
    const h = harness();
    await expect(h.svc.preview(AVUKAT, { kind: "dosyalar", csv: CSV })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("Faz 8E: duruşma göçü", () => {
  it("geçmiş → YAPILDI; aynı gün mükerrer ATLA; bilinmeyen dosya HATA", async () => {
    const h = harness();
    const csv = ["esas_no;tarih;salon", "2024/1;01.02.2025 10:00;2", "2024-1;05.05.2026;", "2024/1;2099-01-01T09:00;", "2020/9;01.01.2026;"].join("\n");
    const p = await h.svc.preview(PARTNER, { kind: "durusmalar", csv });
    expect(p.rows.map((r) => r.action)).toEqual(["EKLE", "ATLA", "EKLE", "HATA"]);
    expect(p.rows[0].notes).toContain("geçmiş tarih → YAPILDI");
    const r = await h.svc.run(PARTNER, { kind: "durusmalar", csv });
    expect(r.created).toBe(2);
    expect(h.created.hearing[0]).toMatchObject({ caseId: "k-1", status: "YAPILDI", courtroom: "2" });
    expect(h.created.hearing[1]).toMatchObject({ status: "PLANLANDI" });
  });
});
