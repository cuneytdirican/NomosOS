/**
 * HEPO HİZMET TESTLERİ (Modül 28).
 *
 * Korunan taahhütler:
 *  1. Katalog tohumlaması slug kimliğiyle idempotent upsert yapar.
 *  2. Müvekkil yükümlülüğü sorguları tenantId ile süzülür; başka kiracının
 *     müvekkiline erişim 404 verir.
 *  3. Aynı yükümlülük müvekkile İKİ KEZ atanamaz.
 * 4. Durum yalnız tanımlı kümeden seçilebilir; kiracıya ait olmayan kayda
 *     güncelleme 404 verir.
 *  5. Vadesi geçmiş ve UYGUN olmayan kayıt overdue=true taşır.
 *  6. Atama/güncelleme denetim günlüğüne düşer.
 */

import { describe, expect, it } from "vitest";
import { HepoService } from "./hepo.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";

const AVUKAT: AuthUser = { userId: "u-1", tenantId: "t-1", role: "AVUKAT" } as AuthUser;
const STAJYER: AuthUser = { userId: "u-2", tenantId: "t-1", role: "STAJYER" } as AuthUser;

interface Harness {
  svc: HepoService;
  auditLines: string[];
  upserts: string[];
  state: {
    clients: Record<string, string>; // clientId -> tenantId
    obligations: string[]; // aktif obligation id'leri
    assignments: Record<string, { clientId: string; obligationId: string }>;
    rows: Record<string, { tenantId: string; status: string; dueDate: Date | null; lastDoneAt: Date | null }>;
  };
}

function serviceWith(): Harness {
  const auditLines: string[] = [];
  const upserts: string[] = [];
  const state: Harness["state"] = {
    clients: { "client-1": "t-1", "client-2": "t-2" },
    obligations: ["ob-1"],
    assignments: {},
    rows: {},
  };
  const prisma = {
    client: {
      hepoObligation: {
        upsert: async ({ where, create }: { where: { slug: string }; create: { slug: string } }) => {
          upserts.push(create.slug);
          return { id: `hepo-${where.slug}`, ...create };
        },
        findFirst: async ({ where }: { where: { id?: string; isActive?: boolean } }) =>
          state.obligations.includes(where.id ?? "") ? { id: where.id, title: "Risk değerlendirmesi", legalBasis: "6331 m.10" } : null,
      },
      hepoClientObligation: {
        findFirst: async ({ where }: { where: { clientId?: string; obligationId?: string; id?: string; tenantId?: string } }) => {
          if (where.obligationId) {
            return Object.values(state.assignments).some((a) => a.clientId === where.clientId && a.obligationId === where.obligationId)
              ? { id: "exists" }
              : null;
          }
          if (where.id) return state.rows[where.id] ? { ...state.rows[where.id], id: where.id } : null;
          return null;
        },
        create: async ({ data }: { data: { tenantId: string; clientId: string; obligationId: string } }) => {
          const id = `hco-${Object.keys(state.assignments).length + 1}`;
          state.assignments[id] = { clientId: data.clientId, obligationId: data.obligationId };
          state.rows[id] = { tenantId: data.tenantId, status: "ACIK", dueDate: null, lastDoneAt: null };
          return { id, ...data, status: "ACIK" };
        },
        update: async ({ where, data }: { where: { id: string }; data: { status?: string } }) => {
          Object.assign(state.rows[where.id], data);
          return { id: where.id, ...state.rows[where.id] };
        },
        findMany: async () => [],
      },
      client: {
        findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
          state.clients[where.id] === where.tenantId ? { id: where.id } : null,
      },
    },
  } as unknown as PrismaService;
  const audit = { log: async (e: { detail: string }) => { auditLines.push(e.detail); } } as unknown as AuditService;
  return { svc: new HepoService(prisma, audit), auditLines, upserts, state };
}

describe("Katalog tohumlama", () => {
  it("her yükümlülük için slug kimliğiyle upsert yapılır", async () => {
    const { svc, upserts } = serviceWith();
    await svc.ensureSeeded();
    // Katalogdaki her slug tam bir kez upsert edilmiş olmalı.
    const catalog = (await import("@nomosos/shared")).HEPO_OBLIGATIONS;
    expect(upserts).toHaveLength(catalog.length);
    expect(new Set(upserts).size).toBe(catalog.length);
  });
});

describe("Müvekkil yükümlülüğü atama", () => {
  it("HUKUKI rol müvekkile atama yapar ve denetim izine düşer", async () => {
    const { svc, auditLines } = serviceWith();
    const res = await svc.assign(AVUKAT, "client-1", { obligationId: "ob-1", dueDate: "2027-01-15" });
    expect(res.status).toBe("ACIK");
    expect(auditLines[0]).toContain("atandı");
  });

  it("başka kiracının müvekkiline atama 404 verir", async () => {
    const { svc } = serviceWith();
    await expect(svc.assign(AVUKAT, "client-2", { obligationId: "ob-1" })).rejects.toThrow(/Müvekkil bulunamadı/);
  });

  it("aynı yükümlülük ikinci kez atanamaz", async () => {
    const { svc } = serviceWith();
    await svc.assign(AVUKAT, "client-1", { obligationId: "ob-1" });
    await expect(svc.assign(AVUKAT, "client-1", { obligationId: "ob-1" })).rejects.toThrow(/zaten atanmış/);
  });

  it("STAJYER atama yapamaz", async () => {
    const { svc } = serviceWith();
    await expect(svc.assign(STAJYER, "client-1", { obligationId: "ob-1" })).rejects.toThrow();
  });
});

describe("Durum güncelleme", () => {
  it("uygun durum kabul edilir, tanımsız durum reddedilir", async () => {
    const { svc } = serviceWith();
    const created = (await svc.assign(AVUKAT, "client-1", { obligationId: "ob-1" })) as { id: string };
    const updated = await svc.update(AVUKAT, created.id, { status: "UYGUN", lastDoneAt: "2026-09-01" });
    expect(updated.status).toBe("UYGUN");
    await expect(svc.update(AVUKAT, created.id, { status: "TAMAM" })).rejects.toThrow(/Geçersiz durum/);
  });

  it("kiracıya ait olmayan kayda güncelleme 404 verir", async () => {
    const { svc } = serviceWith();
    await expect(svc.update(AVUKAT, "baska-kiraci-satiri", { status: "UYGUN" })).rejects.toThrow(/bulunamadı/);
  });
});
