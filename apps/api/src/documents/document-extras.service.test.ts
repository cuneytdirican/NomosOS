/**
 * FAZ 7A — belge sürümü / klasör / paylaşım bağlantısı.
 *
 * Korunan taahhütler:
 *  1. Klasör yolu normalize edilir; ".." reddedilir (yol gezinme yok).
 *  2. Yeni sürüm: yükleme hattından geçer, zincire bağlanır (root/versionNo), eski sürüm işaretlenir;
 *     aynı hash → sürüm açılmaz. Eski (yerini yeni sürüm almış) belgeden sürüm açılamaz.
 *  3. Paylaşım: jeton yanıtta döner ama DB'de yalnız SHA-256 özeti durur; kamusal çözümleme
 *     süre/iptal/sayı kapılarını uygular ve her erişim denetime düşer.
 *  4. Kiracı sınırı: başka kiracının belgesi 404.
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException, GoneException, NotFoundException } from "@nestjs/common";
import { DocumentExtrasService, hashShareToken } from "./document-extras.service";
import { normalizeFolderPath } from "./documents.dto";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { StorageService } from "../storage/storage.service";
import type { DocumentsService } from "./documents.service";
import type { AuthUser } from "../common/types";

const AVUKAT = { userId: "u-1", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;

function harness() {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set("d-1", { id: "d-1", tenantId: "buro-A", name: "Dilekçe.pdf", caseId: "case-A", class: "DILEKCE", hash: "h1", folderPath: "/", versionNo: 1, rootDocumentId: null, supersededAt: null, deletedAt: null, storageKey: "k/d-1" });
  const shares = new Map<string, Record<string, unknown>>();
  const audits: Record<string, unknown>[] = [];
  const client = {
    document: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const d = docs.get(where.id);
        return d && d.tenantId === where.tenantId && !d.deletedAt ? d : null;
      }),
      findMany: vi.fn(async () => [...docs.values()].filter((d) => !d.deletedAt)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const d = { ...(docs.get(where.id) ?? {}), ...data };
        docs.set(where.id, d);
        return d;
      }),
      groupBy: vi.fn(async () => [{ folderPath: "/", _count: { _all: 2 } }, { folderPath: "/Dilekçeler", _count: { _all: 1 } }]),
    },
    documentShareLink: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `s-${shares.size + 1}`, downloads: 0, revokedAt: null, lastAccessAt: null, createdAt: new Date(), ...data };
        shares.set(row.id as string, row);
        return row;
      }),
      findMany: vi.fn(async () => [...shares.values()]),
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const r = shares.get(where.id);
        return r && r.tenantId === where.tenantId ? r : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const r = [...shares.values()].find((x) => x.tokenHash === where.tokenHash);
        if (!r) return null;
        return { ...r, document: docs.get(r.documentId as string) };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = { ...(shares.get(where.id) ?? {}), ...data };
        shares.set(where.id, r);
        return r;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; downloads?: { lt: number } }; data: { downloads: { increment: number }; lastAccessAt: Date } }) => {
        const r = shares.get(where.id);
        if (!r) return { count: 0 };
        if (where.downloads && !((r.downloads as number) < where.downloads.lt)) return { count: 0 };
        r.downloads = (r.downloads as number) + data.downloads.increment;
        r.lastAccessAt = data.lastAccessAt;
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const upload = vi.fn(async (_u: AuthUser, file: { originalname: string } | undefined, input: Record<string, unknown>) => {
    const id = `d-${docs.size + 1}`;
    const row = { id, tenantId: "buro-A", name: file?.originalname ?? "x", caseId: input.caseId ?? null, class: input.class, hash: file?.originalname === "same.pdf" ? "h1" : `h-${id}`, folderPath: input.folderPath, versionNo: 1, rootDocumentId: null, supersededAt: null, deletedAt: null };
    docs.set(id, row);
    return { duplicate: false, document: row, pipeline: null, message: null };
  });
  const storage = { getPresignedDownloadUrl: vi.fn(async (key: string) => `https://minio/${key}?signed`) };
  const svc = new DocumentExtrasService(
    { client } as unknown as PrismaService,
    { log: vi.fn(async (e: Record<string, unknown>) => audits.push(e)) } as unknown as AuditService,
    storage as unknown as StorageService,
    { upload } as unknown as DocumentsService,
  );
  return { svc, docs, shares, audits, upload, client };
}

describe("Faz 7A: normalizeFolderPath", () => {
  it("normalize + yol gezinme reddi", () => {
    expect(normalizeFolderPath(undefined)).toBe("/");
    expect(normalizeFolderPath(" Dilekçeler / 2026 ")).toBe("/Dilekçeler/2026");
    expect(normalizeFolderPath("\\Kararlar\\")).toBe("/Kararlar");
    expect(() => normalizeFolderPath("/a/../b")).toThrow(BadRequestException);
    expect(() => normalizeFolderPath("/" + "x".repeat(201))).toThrow(BadRequestException);
  });
});

describe("Faz 7A: sürümler", () => {
  it("yeni sürüm zincire bağlanır, eski sürüm işaretlenir, hat yeniden koşar", async () => {
    const h = harness();
    const res = await h.svc.newVersion(AVUKAT, "d-1", { originalname: "Dilekçe-v2.pdf" } as Express.Multer.File, "imza düzeltildi");
    expect(h.upload).toHaveBeenCalledWith(AVUKAT, expect.anything(), expect.objectContaining({ caseId: "case-A", class: "DILEKCE", allowDuplicate: true, folderPath: "/" }));
    expect(res.document.versionNo).toBe(2);
    expect(res.document.rootDocumentId).toBe("d-1");
    expect(h.docs.get("d-1")?.supersededAt).toBeInstanceOf(Date);
    expect(h.audits.at(-1)).toMatchObject({ action: "DOCUMENT_VERSION" });
    const chain = await h.svc.versions(AVUKAT, "d-1");
    expect(chain.rootDocumentId).toBe("d-1");
    expect(chain.current).toBe(res.document.id);
  });

  it("aynı içerik (hash) → sürüm açılmaz, yüklenen kayıt yumuşak silinir", async () => {
    const h = harness();
    await expect(h.svc.newVersion(AVUKAT, "d-1", { originalname: "same.pdf" } as Express.Multer.File)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.docs.get("d-2")?.deletedAt).toBeInstanceOf(Date);
    expect(h.docs.get("d-1")?.supersededAt).toBeNull();
  });

  it("yerini yeni sürüm almış belgeden sürüm açılamaz; başka kiracı 404", async () => {
    const h = harness();
    h.docs.get("d-1")!.supersededAt = new Date();
    await expect(h.svc.newVersion(AVUKAT, "d-1", { originalname: "v3.pdf" } as Express.Multer.File)).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.svc.versions({ ...AVUKAT, tenantId: "buro-B" }, "d-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("Faz 7A: paylaşım bağlantısı", () => {
  it("jeton yalnız özet olarak saklanır; çözümleme sayacı artırır ve denetime yazar", async () => {
    const h = harness();
    const created = await h.svc.createShare(AVUKAT, "d-1", { ttlHours: 24, maxDownloads: 2, note: "müvekkile" });
    const token = created.url.split("/paylasim/")[1];
    expect(token.length).toBeGreaterThan(30);
    const stored = [...h.shares.values()][0];
    expect(stored.tokenHash).toBe(hashShareToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);

    const first = await h.svc.resolvePublic(token);
    expect(first.url).toContain("signed");
    await h.svc.resolvePublic(token);
    await expect(h.svc.resolvePublic(token)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.audits.filter((a) => a.action === "DOCUMENT_SHARE_ACCESS")).toHaveLength(2);
    const list = await h.svc.listShares(AVUKAT, "d-1");
    expect(list[0]).toMatchObject({ downloads: 2, durum: "TUKENDI" });
  });

  it("süresi dolmuş / iptal edilmiş / bilinmeyen jeton", async () => {
    const h = harness();
    const created = await h.svc.createShare(AVUKAT, "d-1", { ttlHours: 1, maxDownloads: null, note: null });
    const token = created.url.split("/paylasim/")[1];
    await h.svc.revokeShare(AVUKAT, "s-1");
    await expect(h.svc.resolvePublic(token)).rejects.toBeInstanceOf(GoneException);
    const second = await h.svc.createShare(AVUKAT, "d-1", { ttlHours: 1, maxDownloads: null, note: null });
    h.shares.get("s-2")!.expiresAt = new Date(Date.now() - 1000);
    await expect(h.svc.resolvePublic(second.url.split("/paylasim/")[1])).rejects.toBeInstanceOf(GoneException);
    await expect(h.svc.resolvePublic("yok-boyle-bir-jeton-uzunlugu-yeterli-olsun")).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.svc.revokeShare({ ...AVUKAT, tenantId: "buro-B" }, "s-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
