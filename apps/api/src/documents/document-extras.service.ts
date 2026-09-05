/**
 * FAZ 7A — belge sürümleri, sanal klasörler ve süreli paylaşım bağlantıları.
 *
 * Sürüm: yeni sürüm AYRI bir Document kaydıdır (kendi hattı, OCR'ı, hash'i); eski
 * sürüm `supersededAt` ile işaretlenir ve listelerde varsayılan gizlenir. Zincir
 * `rootDocumentId` ile bağlanır; hiçbir sürüm silinmez (kanıt bütünlüğü).
 *
 * Paylaşım: jeton yalnız SHA-256 özetiyle saklanır; bağlantı süre + indirme sayısı
 * ile sınırlıdır ve her erişim AuditLog'a düşer. Kamusal uç 302 ile MinIO'nun 5 dk
 * geçerli imzalı adresine yönlendirir — depo adresi hiçbir zaman kalıcı paylaşılmaz.
 */

import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { DocumentsService } from "./documents.service";
import { normalizeFolderPath, type UploadDocumentInput } from "./documents.dto";
import { DOCUMENT_CLASSES } from "@nomosos/shared";
import { apiPublicUrl } from "../common/public-urls";
import { relatedCaseVisibilityWhere } from "../common/case-visibility";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";

export const shareLinkSchema = z.object({
  /** 1 saat – 7 gün. */
  ttlHours: z.coerce.number().int().min(1).max(168).default(24),
  maxDownloads: z.coerce.number().int().min(1).max(100).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});
export type ShareLinkInput = z.infer<typeof shareLinkSchema>;

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class DocumentExtrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
  ) {}

  /** Dosyadaki (veya dosyasız) belgelerin klasör yolları + sayıları. */
  async folders(user: AuthUser, caseId?: string) {
    const rows = await this.prisma.client.document.groupBy({
      by: ["folderPath"],
      where: {
        tenantId: user.tenantId,
        deletedAt: null,
        supersededAt: null,
        ...(caseId ? { caseId } : {}),
        ...relatedCaseVisibilityWhere(user, { optionalCase: true }),
      },
      _count: { _all: true },
      orderBy: { folderPath: "asc" },
    });
    return rows.map((r) => ({ path: r.folderPath, count: r._count._all }));
  }

  /** Belgeyi başka klasöre taşı (yol yoksa oluşur — klasör tablosu yok). */
  async move(user: AuthUser, id: string, folderPath: string) {
    assertRole(user, ROLE_SETS.OPERASYON, "belge taşıma");
    const path = normalizeFolderPath(folderPath);
    const doc = await this.requireDocument(user.tenantId, id);
    await this.prisma.client.document.update({ where: { id: doc.id }, data: { folderPath: path } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "DOCUMENT_MOVE", entity: "Document", entityId: doc.id, detail: `${doc.folderPath} → ${path}` });
    return { id: doc.id, folderPath: path };
  }

  /** Sürüm zinciri (en yeni önce). */
  async versions(user: AuthUser, id: string) {
    const doc = await this.requireDocument(user.tenantId, id);
    const rootId = doc.rootDocumentId ?? doc.id;
    const rows = await this.prisma.client.document.findMany({
      where: { tenantId: user.tenantId, deletedAt: null, OR: [{ id: rootId }, { rootDocumentId: rootId }] },
      orderBy: { versionNo: "desc" },
      select: { id: true, name: true, versionNo: true, sizeBytes: true, mimeType: true, uploadedBy: true, createdAt: true, supersededAt: true, hash: true },
    });
    return { rootDocumentId: rootId, current: rows.find((r) => !r.supersededAt)?.id ?? null, items: rows };
  }

  /**
   * Yeni sürüm: normal yükleme hattından geçer (hash/kota/doğrulama/OCR), sonra
   * zincire bağlanır ve eski sürüm işaretlenir. Aynı içerik (hash) yeniden yüklenirse
   * sürüm açılmaz — anlamsız kopya.
   */
  async newVersion(user: AuthUser, id: string, file: Express.Multer.File | undefined, note?: string | null) {
    assertRole(user, ROLE_SETS.OPERASYON, "belge sürümü yükleme");
    const previous = await this.requireDocument(user.tenantId, id);
    if (previous.supersededAt) throw new BadRequestException("Bu sürümün yerini daha yeni bir sürüm almış; yeni sürümü güncel belgeden yükleyin.");
    const result = await this.documents.upload(user, file, {
      caseId: previous.caseId ?? undefined,
      // Paylaşılan DOCUMENT_CLASSES listesi Prisma enum'unun alt kümesi; dışındaki sınıf yükleme şemasında DIGER'e düşer.
      class: ((DOCUMENT_CLASSES as readonly string[]).includes(previous.class) ? previous.class : "DIGER") as UploadDocumentInput["class"],
      name: file?.originalname ? undefined : previous.name,
      source: "MANUEL",
      allowDuplicate: true,
      folderPath: previous.folderPath,
    });
    const created = result.document;
    if (created.id === previous.id) throw new BadRequestException("Yüklenen dosya mevcut sürümle aynı.");
    if (created.hash && created.hash === previous.hash) {
      // Aynı içerik: kaydı yumuşak sil, sürüm açma.
      await this.prisma.client.document.update({ where: { id: created.id }, data: { deletedAt: new Date() } });
      throw new BadRequestException("Yüklenen dosya mevcut sürümle birebir aynı içerikte; yeni sürüm açılmadı.");
    }
    const rootId = previous.rootDocumentId ?? previous.id;
    const now = new Date();
    await this.prisma.client.$transaction([
      this.prisma.client.document.update({ where: { id: created.id }, data: { rootDocumentId: rootId, versionNo: previous.versionNo + 1, folderPath: previous.folderPath } }),
      this.prisma.client.document.update({ where: { id: previous.id }, data: { supersededAt: now } }),
    ]);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DOCUMENT_VERSION",
      entity: "Document",
      entityId: created.id,
      detail: `${previous.name} v${previous.versionNo} → v${previous.versionNo + 1}${note ? ` — ${note.slice(0, 200)}` : ""}`,
    });
    return { ...result, document: { ...created, rootDocumentId: rootId, versionNo: previous.versionNo + 1 }, previousId: previous.id };
  }

  async createShare(user: AuthUser, id: string, input: ShareLinkInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "belge paylaşım bağlantısı");
    const doc = await this.requireDocument(user.tenantId, id);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + input.ttlHours * 3_600_000);
    const row = await this.prisma.client.documentShareLink.create({
      data: { tenantId: user.tenantId, documentId: doc.id, tokenHash: hashShareToken(token), expiresAt, maxDownloads: input.maxDownloads ?? null, note: input.note ?? null, createdBy: user.userId },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "DOCUMENT_SHARE_CREATE", entity: "Document", entityId: doc.id, detail: `${doc.name} — ${input.ttlHours} sa${input.maxDownloads ? `, en çok ${input.maxDownloads} indirme` : ""}` });
    return { id: row.id, url: `${apiPublicUrl()}/api/v1/public/paylasim/${token}`, expiresAt, maxDownloads: row.maxDownloads, note: row.note };
  }

  async listShares(user: AuthUser, id: string) {
    const doc = await this.requireDocument(user.tenantId, id);
    const rows = await this.prisma.client.documentShareLink.findMany({ where: { tenantId: user.tenantId, documentId: doc.id }, orderBy: { createdAt: "desc" }, take: 50 });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      expiresAt: r.expiresAt,
      maxDownloads: r.maxDownloads,
      downloads: r.downloads,
      note: r.note,
      createdAt: r.createdAt,
      revokedAt: r.revokedAt,
      lastAccessAt: r.lastAccessAt,
      durum: r.revokedAt ? "IPTAL" : r.expiresAt.getTime() < now ? "SURESI_DOLDU" : r.maxDownloads !== null && r.downloads >= r.maxDownloads ? "TUKENDI" : "AKTIF",
    }));
  }

  async revokeShare(user: AuthUser, shareId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "paylaşım iptali");
    const row = await this.prisma.client.documentShareLink.findFirst({ where: { id: shareId, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException("Paylaşım bağlantısı bulunamadı.");
    if (!row.revokedAt) await this.prisma.client.documentShareLink.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "DOCUMENT_SHARE_REVOKE", entity: "Document", entityId: row.documentId, detail: shareId });
    return { ok: true };
  }

  /** Kamusal çözümleme: jeton → imzalı indirme adresi. Kimliksiz; her erişim denetime düşer. */
  async resolvePublic(token: string): Promise<{ url: string; name: string }> {
    if (!token || token.length < 20 || token.length > 200) throw new NotFoundException("Bağlantı geçersiz.");
    const row = await this.prisma.client.documentShareLink.findUnique({
      where: { tokenHash: hashShareToken(token) },
      include: { document: { select: { id: true, name: true, storageKey: true, deletedAt: true } } },
    });
    if (!row || row.document.deletedAt) throw new NotFoundException("Bağlantı geçersiz.");
    if (row.revokedAt) throw new GoneException("Bu paylaşım bağlantısı iptal edilmiş.");
    if (row.expiresAt.getTime() < Date.now()) throw new GoneException("Bu paylaşım bağlantısının süresi dolmuş.");
    if (row.maxDownloads !== null && row.downloads >= row.maxDownloads) throw new ForbiddenException("Bu bağlantının indirme hakkı tükenmiş.");
    const updated = await this.prisma.client.documentShareLink.updateMany({
      where: { id: row.id, ...(row.maxDownloads !== null ? { downloads: { lt: row.maxDownloads } } : {}) },
      data: { downloads: { increment: 1 }, lastAccessAt: new Date() },
    });
    if (updated.count === 0) throw new ForbiddenException("Bu bağlantının indirme hakkı tükenmiş.");
    const url = await this.storage.getPresignedDownloadUrl(row.document.storageKey, 300, row.document.name);
    await this.audit.log({ tenantId: row.tenantId, userId: row.createdBy, action: "DOCUMENT_SHARE_ACCESS", entity: "Document", entityId: row.document.id, detail: `paylaşım ${row.id} — indirme ${row.downloads + 1}${row.maxDownloads ? `/${row.maxDownloads}` : ""}` });
    return { url, name: row.document.name };
  }

  private async requireDocument(tenantId: string, id: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, caseId: true, class: true, hash: true, folderPath: true, versionNo: true, rootDocumentId: true, supersededAt: true },
    });
    if (!doc) throw new NotFoundException("Belge bulunamadı.");
    return doc;
  }
}
