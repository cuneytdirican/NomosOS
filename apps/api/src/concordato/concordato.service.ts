/**
 * KONKORDATO / İFLAS SÜREÇ TAKİBİ (geliştirme planı D4 / A6).
 *
 * İki ayrı süreç şeridi, TEK model:
 *   CONCORDATO (İİK m.285-302):
 *     BASVURU → ÖN_INCELEME → GECICI_ERTELEME → KESIN_ERTELEME →
 *     (ONAYLANDI | REDDEDILDI | FERAGAT)
 *   IFLAS (İİK m.154-168):
 *     TALEP → (GECIKME →) IFLAS_KARARI → IFLAS_IDARESI → (INFIS | SONA_ERDI)
 *
 * DÜRÜSTLÜK (ürün ilkesi): otomatik yasal süre üretimi YOKTUR. Konkordato
 * süre hükümleri (m.286-293) koşullu ve içtihatlıdır; süreleri avukat
 * mevcut süre motorundan (Deadline) elle kurar. Bu modül AŞAMA ve TARİH
 * kaydı tutar — hesap uydurmaz.
 *
 * Geçiş makinesi enforcement-stage.ts deseniyledir: keyfi sıçrama 422.
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";

export const CONCORDATO_STATUSES = [
  "BASVURU",
  "ON_INCELEME",
  "GECICI_ERTELEME",
  "KESIN_ERTELEME",
  "ONAYLANDI",
  "REDDEDILDI",
  "FERAGAT",
] as const;
export type ConcordatoStatus = Exclude<(typeof CONCORDATO_STATUSES)[number], never>;

export const IFLAS_STATUSES = [
  "TALEP",
  "GECIKME",
  "IFLAS_KARARI",
  "IFLAS_IDARESI",
  "INFIS",
  "SONA_ERDI",
  "RED",
] as const;
export type IflasStatus = (typeof IFLAS_STATUSES)[number];

const CONCORDATO_LABELS: Record<string, string> = {
  BASVURU: "Başvuru (m.285)",
  ON_INCELEME: "Ön inceleme",
  GECICI_ERTELEME: "Geçici erteleme (m.286)",
  KESIN_ERTELEME: "Kesin erteleme (m.287)",
  ONAYLANDI: "Konkordato onaylandı",
  "REDDEDILDI": "Reddedildi",
  FERAGAT: "Feragat/geri çekme",
};

const IFLAS_LABELS: Record<string, string> = {
  TALEP: "İflas talebi (m.155+)",
  GECIKME: "Gecikme kararı (m.166)",
  IFLAS_KARARI: "İflas kararı (m.166)",
  IFLAS_IDARESI: "İflas idaresi",
  INFIS: "İnfis (dağıtım tamam)",
  SONA_ERDI: "Sona erdi",
  RED: "Talebin reddi",
};

/** CONCORDATO şeridi — m.285-302 akışı. */
const CONCORDATO_NEXT: Record<string, readonly string[]> = {
  BASVURU: ["ON_INCELEME", "FERAGAT", "REDDEDILDI"],
  ON_INCELEME: ["GECICI_ERTELEME", "REDDEDILDI", "FERAGAT"],
  GECICI_ERTELEME: ["KESIN_ERTELEME", "REDDEDILDI", "FERAGAT"],
  KESIN_ERTELEME: ["ONAYLANDI", "REDDEDILDI", "FERAGAT"],
  ONAYLANDI: [],
  "REDDEDILDI": [],
  FERAGAT: [],
};

/** IFLAS şeridi — m.154-168 akışı. */
const IFLAS_NEXT: Record<string, readonly string[]> = {
  TALEP: ["GECIKME", "IFLAS_KARARI", "RED"],
  GECIKME: ["IFLAS_KARARI", "RED"],
  IFLAS_KARARI: ["IFLAS_IDARESI", "SONA_ERDI"],
  IFLAS_IDARESI: ["INFIS", "SONA_ERDI"],
  INFIS: [],
  SONA_ERDI: [],
  RED: [],
};

export function concordatoTransitions(processType: string): Record<string, readonly string[]> {
  return processType === "IFLAS" ? IFLAS_NEXT : CONCORDATO_NEXT;
}

export function concordatoLabel(processType: string, status: string): string {
  return (processType === "IFLAS" ? IFLAS_LABELS : CONCORDATO_LABELS)[status] ?? status;
}

@Injectable()
export class ConcordatoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, filters: { processType?: string; caseId?: string; status?: string }) {
    return this.prisma.client.concordatoProcess.findMany({
      where: {
        tenantId: user.tenantId,
        ...(filters.processType === "IFLAS" || filters.processType === "CONCORDATO"
          ? { processType: filters.processType }
          : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.caseId ? { caseId: filters.caseId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { case: { select: { id: true, title: true, fileNumber: true } } },
    });
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.prisma.client.concordatoProcess.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { case: { select: { id: true, title: true, fileNumber: true } } },
    });
    if (!row) throw new NotFoundException("Konkordato/iflas kaydı bulunamadı.");
    return row;
  }

  async create(
    user: AuthUser,
    input: {
      processType: string;
      caseId?: string;
      court?: string;
      fileNo?: string;
      stageAt?: string | null;
      note?: string;
    },
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "konkordato/iflas kaydı oluşturma");
    const processType = input.processType === "IFLAS" ? "IFLAS" : "CONCORDATO";
    if (input.caseId) {
      const c = await this.prisma.client.case.findFirst({
        where: { id: input.caseId, tenantId: user.tenantId },
        select: { id: true },
      });
      if (!c) throw new NotFoundException("Dosya bulunamadı.");
    }
    const created = await this.prisma.client.concordatoProcess.create({
      data: {
        tenantId: user.tenantId,
        processType,
        status: processType === "IFLAS" ? "TALEP" : "BASVURU",
        caseId: input.caseId ?? null,
        court: input.court?.trim() || null,
        fileNo: input.fileNo?.trim() || null,
        ...(input.stageAt ? { stageAt: new Date(input.stageAt) } : {}),
        note: input.note?.trim() || null,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONCORDATO_CREATE",
      entity: "ConcordatoProcess",
      entityId: created.id,
      detail: `${processType === "IFLAS" ? "İflas" : "Konkordato"} talebi — ${input.court ?? "mahkeme yok"}`,
    });
    return created;
  }

  /** Aşama geçişi — şerit dışına sıçrama 400. */
  async transition(
    user: AuthUser,
    id: string,
    input: { status: string; stageAt?: string | null; note?: string | null },
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "konkordato/iflas durumu değiştirme");
    const existing = await this.prisma.client.concordatoProcess.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException("Konkordato/iflas kaydı bulunamadı.");

    const next = input.status;
    const chain = concordatoTransitions(existing.processType);
    const allowed = chain[existing.status] ?? [];
    if (!allowed.length) {
      throw new BadRequestException(
        `Bu kayıt «${concordatoLabel(existing.processType, existing.status)}» aşamasında tamamlandı; değiştirilemez.`,
      );
    }
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `«${concordatoLabel(existing.processType, existing.status)}» aşamasından «${next}» aşamasına geçilemez. ` +
          `İzin verilenler: ${allowed.map((s) => concordatoLabel(existing.processType, s)).join(", ")}.`,
      );
    }

    const updated = await this.prisma.client.concordatoProcess.update({
      where: { id },
      data: {
        status: next,
        stageAt: input.stageAt ? new Date(input.stageAt) : new Date(),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONCORDATO_TRANSITION",
      entity: "ConcordatoProcess",
      entityId: id,
      detail: `${concordatoLabel(existing.processType, existing.status)} → ${concordatoLabel(existing.processType, next)}`,
    });
    return updated;
  }
}
