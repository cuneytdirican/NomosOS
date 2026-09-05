/**
 * FAZ 8B — sözleşme kabulü.
 *  1. Başlangıçta zorunlu belgeler eksik; kabul sonrası tamam; SLA zorunlu değil.
 *  2. Sürüm uyuşmazlığı 400; ONAY rolü dışı 403.
 *  3. Kabul ekleme-yalnız; özet metnin SHA-256'sı — metin değişince (özet farklı) "güncel değil".
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { TermsService, contractHash } from "./terms.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";

const PARTNER = { userId: "u-p", tenantId: "buro-A", role: "PARTNER" } as AuthUser;
const AVUKAT = { userId: "u-a", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;

function harness() {
  const rows: Record<string, unknown>[] = [];
  const client = {
    termsAcceptance: {
      findMany: vi.fn(async ({ where }: { where: { tenantId: string } }) => [...rows].reverse().filter((r) => r.tenantId === where.tenantId)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `t-${rows.length + 1}`, acceptedAt: new Date(Date.now() + rows.length), ...data };
        rows.push(r);
        return r;
      }),
    },
    user: { findMany: vi.fn(async () => [{ id: "u-p", fullName: "Ortak", email: "p@x.tr" }]) },
  };
  return { svc: new TermsService({ client } as unknown as PrismaService, { log: vi.fn(async () => undefined) } as unknown as AuditService), rows };
}

describe("Faz 8B: TermsService", () => {
  it("zorunlu belgeler eksik → kabul → tamam; SLA zorunlu değil", async () => {
    const h = harness();
    const before = await h.svc.status("buro-A");
    expect(before.missingRequired.sort()).toEqual(["DPA", "HIZMET_SOZLESMESI", "MESAFELI_SATIS"]);
    await h.svc.accept(PARTNER, { docKey: "HIZMET_SOZLESMESI", version: "v1" }, { ip: "1.1.1.1", userAgent: "UA" });
    await h.svc.accept(PARTNER, { docKey: "DPA", version: "v1" }, { ip: null, userAgent: null });
    const after = await h.svc.accept(PARTNER, { docKey: "MESAFELI_SATIS", version: "v1" }, { ip: null, userAgent: null });
    expect(after.missingRequired).toEqual([]);
    expect(after.items.find((i) => i.key === "SLA")?.required).toBe(false);
    expect(after.items.find((i) => i.key === "DPA")).toMatchObject({ accepted: true, acceptedBy: { fullName: "Ortak" } });
    expect(h.rows[0]).toMatchObject({ textHash: contractHash("HIZMET_SOZLESMESI"), ip: "1.1.1.1" });
  });

  it("sürüm uyuşmazlığı 400; avukat 403", async () => {
    const h = harness();
    await expect(h.svc.accept(PARTNER, { docKey: "DPA", version: "v0" }, { ip: null, userAgent: null })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.svc.accept(AVUKAT, { docKey: "DPA", version: "v1" }, { ip: null, userAgent: null })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("özet metne bağlı: eski özetli kabul 'güncel değil' sayılır", async () => {
    const h = harness();
    h.rows.push({ id: "t-old", tenantId: "buro-A", userId: "u-p", docKey: "DPA", version: "v1", textHash: "eski-ozet", acceptedAt: new Date() });
    const s = await h.svc.status("buro-A");
    expect(s.items.find((i) => i.key === "DPA")).toMatchObject({ accepted: false, outdated: true });
    const platform = await h.svc.historyForPlatform("buro-A");
    expect(platform.history).toHaveLength(1);
    expect(platform.missingRequired).toContain("DPA");
  });
});
