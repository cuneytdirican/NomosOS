/**
 * KVKK SAKLAMA / İMHA POLİTİKASI + VERİ ÖZNESİ TALEPLERİ (Enterprise++).
 *
 * Hukuki çerçeve (docs/kvkk-politika-matrisi.md):
 *  - Avukatlık K. m.39: dosya, vekâlet bitse bile SAKLANIR → saklama süresi
 *    kapanış + `Tenant.retentionYears` (varsayılan 10 yıl).
 *  - KVKK m.7: silme talebi, kanuni saklama yükümlülüğü varsa GEREKÇELİ reddedilir;
 *    talep ve gerekçe kayda geçer.
 *  - KVKK m.13/2: veri öznesi talebine en geç 30 gün içinde yanıt.
 *
 * Ürün kararı (dürüstlük): OTOMATİK SİLME YOKTUR. Sistem süresi dolan KAPANDI
 * dosyaları İMHA ADAYI olarak listeler ve aylık işle ADMIN'i uyarır; imhayı
 * ADMIN gerekçeyle tek tek uygular. İmha = belgeler (S3 nesnesi dâhil, en iyi
 * çaba) + RAG parçaları silinir; künye/safahat/denetim izi KALIR (m.39 + iz).
 */

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";

export const RETENTION_YEARS_MIN = 10;
export const RETENTION_YEARS_MAX = 30;
/** KVKK m.13/2 — yanıt süresi (gün). */
export const KVKK_RESPONSE_DAYS = 30;

export const KVKK_REQUEST_TYPES = ["ERISIM", "SILME", "DUZELTME", "ITIRAZ", "TASIMA"] as const;
export type KvkkRequestType = (typeof KVKK_REQUEST_TYPES)[number];
export const KVKK_REQUEST_TYPE_LABELS: Record<KvkkRequestType, string> = {
  ERISIM: "Erişim / bilgi talebi (m.11)",
  SILME: "Silme / yok etme talebi (m.7)",
  DUZELTME: "Düzeltme talebi (m.11-d)",
  ITIRAZ: "İşlemeye itiraz (m.11-g)",
  TASIMA: "Veri taşınabilirliği / dışa aktarım",
};

/** Saklama süresi kesme tarihi: bugünden N yıl geri. */
export function retentionCutoff(retentionYears: number, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - retentionYears);
  return d;
}

/** Yasal yanıt tarihi: talep + 30 gün. */
export function kvkkDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + KVKK_RESPONSE_DAYS * 86_400_000);
}

@Injectable()
export class KvkkService {
  private readonly logger = new Logger(KvkkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------ //
  // Saklama / imha adayları
  // ------------------------------------------------------------------ //

  async retentionYears(tenantId: string): Promise<number> {
    const t = await this.prisma.client.tenant.findUnique({ where: { id: tenantId }, select: { retentionYears: true } });
    return Math.min(RETENTION_YEARS_MAX, Math.max(RETENTION_YEARS_MIN, t?.retentionYears ?? RETENTION_YEARS_MIN));
  }

  /** İmha adayları: KAPANDI + closedAt < kesme + henüz imha edilmemiş. */
  async retentionReport(user: AuthUser, now: Date = new Date()) {
    assertRole(user, ROLE_SETS.ONAY, "KVKK saklama raporunu görüntüleme");
    return this.retentionReportFor(user.tenantId, now);
  }

  async retentionReportFor(tenantId: string, now: Date = new Date()) {
    const years = await this.retentionYears(tenantId);
    const cutoff = retentionCutoff(years, now);
    const [candidates, anonymizedCount, openRequests, overdueRequests] = await Promise.all([
      this.prisma.client.case.findMany({
        where: { tenantId, status: "KAPANDI", closedAt: { lt: cutoff }, anonymizedAt: null },
        select: {
          id: true,
          title: true,
          fileNumber: true,
          closedAt: true,
          client: { select: { id: true, name: true } },
          _count: { select: { documents: { where: { deletedAt: null } } } },
        },
        orderBy: { closedAt: "asc" },
        take: 500,
      }),
      this.prisma.client.case.count({ where: { tenantId, anonymizedAt: { not: null } } }),
      this.prisma.client.kvkkRequest.count({ where: { tenantId, status: "ACIK" } }),
      this.prisma.client.kvkkRequest.count({ where: { tenantId, status: "ACIK", dueAt: { lt: now } } }),
    ]);
    return {
      retentionYears: years,
      cutoff,
      candidates: candidates.map((c) => ({
        id: c.id,
        title: c.title,
        fileNumber: c.fileNumber,
        closedAt: c.closedAt,
        client: c.client,
        documentCount: c._count.documents,
      })),
      anonymizedCount,
      openRequests,
      overdueRequests,
    };
  }

  /**
   * İMHA — yalnız ADMIN, gerekçe zorunlu, yalnız süresi dolmuş KAPANDI dosya.
   * Belgeler yumuşak silinir + S3 nesnesi silinmeye çalışılır (en iyi çaba;
   * başarısız nesneler denetim izinde sayılır), RAG parçaları silinir,
   * dosya `anonymizedAt` ile damgalanır. Künye/safahat KALIR.
   */
  async anonymizeCase(user: AuthUser, caseId: string, reason: string, now: Date = new Date()) {
    assertRole(user, ["ADMIN"], "KVKK imhası uygulama");
    if (reason.trim().length < 10) {
      throw new BadRequestException("İmha gerekçesi en az 10 karakter olmalıdır (denetim izine yazılır).");
    }
    const years = await this.retentionYears(user.tenantId);
    const cutoff = retentionCutoff(years, now);
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId },
      select: { id: true, title: true, fileNumber: true, status: true, closedAt: true, anonymizedAt: true },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");
    if (found.anonymizedAt) throw new BadRequestException("Bu dosyada imha zaten uygulanmış.");
    if (found.status !== "KAPANDI" || !found.closedAt || found.closedAt >= cutoff) {
      throw new ForbiddenException(
        `İmha yalnız saklama süresi (${years} yıl) dolmuş KAPANDI dosyalara uygulanır — Avukatlık K. m.39 saklama yükümlülüğü.`,
      );
    }

    const docs = await this.prisma.client.document.findMany({
      where: { tenantId: user.tenantId, caseId: found.id, deletedAt: null },
      select: { id: true, storageKey: true },
    });
    let storageFailures = 0;
    for (const d of docs) {
      try {
        await this.storage.deleteObject(d.storageKey);
      } catch (err) {
        storageFailures += 1;
        this.logger.warn(`İmha: S3 nesnesi silinemedi (${d.id}): ${(err as Error).message}`);
      }
    }
    const [chunks] = await this.prisma.client.$transaction([
      this.prisma.client.documentChunk.deleteMany({ where: { tenantId: user.tenantId, caseId: found.id } }),
      this.prisma.client.document.updateMany({
        where: { tenantId: user.tenantId, caseId: found.id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.client.case.update({ where: { id: found.id }, data: { anonymizedAt: now } }),
    ]);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "KVKK_IMHA",
      entity: "Case",
      entityId: found.id,
      detail:
        `${found.title}${found.fileNumber ? ` (${found.fileNumber})` : ""} — ${docs.length} belge, ${chunks.count} RAG parçası imha edildi` +
        `${storageFailures ? `; ${storageFailures} S3 nesnesi silinemedi` : ""}. Gerekçe: ${reason.trim()}`,
    });
    return { ok: true as const, caseId: found.id, documents: docs.length, chunks: chunks.count, storageFailures };
  }

  // ------------------------------------------------------------------ //
  // Veri öznesi talepleri
  // ------------------------------------------------------------------ //

  async listRequests(user: AuthUser, query: { status?: string }) {
    assertRole(user, ROLE_SETS.ONAY, "KVKK taleplerini görüntüleme");
    const rows = await this.prisma.client.kvkkRequest.findMany({
      where: { tenantId: user.tenantId, ...(query.status ? { status: query.status.toUpperCase() } : {}) },
      include: { client: { select: { id: true, name: true } } },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      take: 200,
    });
    const now = Date.now();
    return {
      items: rows.map((r) => ({ ...r, overdue: r.status === "ACIK" && r.dueAt.getTime() < now })),
      types: KVKK_REQUEST_TYPE_LABELS,
    };
  }

  async createRequest(user: AuthUser, input: { clientId: string; type: string; subject: string; requestedAt?: string }) {
    assertRole(user, ROLE_SETS.ONAY, "KVKK talebi kaydetme");
    if (!(KVKK_REQUEST_TYPES as readonly string[]).includes(input.type)) {
      throw new BadRequestException(`Geçersiz talep türü. Kabul edilenler: ${KVKK_REQUEST_TYPES.join(", ")}.`);
    }
    const client = await this.prisma.client.client.findFirst({
      where: { id: input.clientId, tenantId: user.tenantId },
      select: { id: true, name: true },
    });
    if (!client) throw new NotFoundException("Müvekkil bulunamadı.");
    const requestedAt = input.requestedAt ? new Date(input.requestedAt) : new Date();
    if (Number.isNaN(requestedAt.getTime())) throw new BadRequestException("Geçersiz talep tarihi.");
    const row = await this.prisma.client.kvkkRequest.create({
      data: {
        tenantId: user.tenantId,
        clientId: client.id,
        type: input.type,
        subject: input.subject.trim(),
        requestedAt,
        dueAt: kvkkDueAt(requestedAt),
        createdBy: user.userId,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "KVKK_REQUEST_CREATE",
      entity: "KvkkRequest",
      entityId: row.id,
      detail: `${client.name} — ${KVKK_REQUEST_TYPE_LABELS[input.type as KvkkRequestType]}; yanıt süresi ${row.dueAt.toISOString().slice(0, 10)}`,
    });
    return row;
  }

  /** Yanıt: YANITLANDI (yerine getirildi) ya da REDDEDILDI (gerekçeli — m.7 saklama istisnası vb.). */
  async respondRequest(user: AuthUser, id: string, input: { status: "YANITLANDI" | "REDDEDILDI"; decision: string }) {
    assertRole(user, ROLE_SETS.ONAY, "KVKK talebine yanıt");
    if (input.decision.trim().length < 10) {
      throw new BadRequestException("Yanıt/gerekçe en az 10 karakter olmalıdır — veri özneye GEREKÇELİ yanıt zorunludur.");
    }
    const row = await this.prisma.client.kvkkRequest.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException("KVKK talebi bulunamadı.");
    if (row.status !== "ACIK") throw new BadRequestException(`Talep zaten ${row.status}.`);
    const updated = await this.prisma.client.kvkkRequest.update({
      where: { id: row.id },
      data: { status: input.status, decision: input.decision.trim(), respondedAt: new Date(), respondedBy: user.userId },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: input.status === "REDDEDILDI" ? "KVKK_REQUEST_REJECT" : "KVKK_REQUEST_RESOLVE",
      entity: "KvkkRequest",
      entityId: row.id,
      detail: `${row.type} → ${input.status}: ${input.decision.trim().slice(0, 200)}`,
    });
    return updated;
  }
}
