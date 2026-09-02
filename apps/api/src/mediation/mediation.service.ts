/**
 * ARABULUCULUK SÜRECİ (geliştirme planı A2) — dava şartı arabuluculuk.
 *
 * Durum zinciri: DAVET → TOPLANTI → SONUC → (ANLASMA | ANLASMA_YOK) → DAVA_ACILDI.
 * ANLASMA_YOK geçişinde son tutanak tarihinden itibaren 6325 s.K. m.18 uyarınca
 * 2 haftalık dava süresi otomatik üretilir (Deadline — kural motorundan) ve
 * arabuluculuk ajandasına/ajandaya düşer.
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DeadlinesService } from "../deadlines/deadlines.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";

export const MEDIATION_STATUSES = [
  "DAVET",
  "TOPLANTI",
  "SONUC",
  "ANLASMA",
  "ANLASMA_YOK",
  "DAVA_ACILDI",
  "FERAGAT",
] as const;
export type MediationStatus = (typeof MEDIATION_STATUSES)[number];

export const STATUS_LABELS: Record<MediationStatus, string> = {
  DAVET: "Davet gönderildi",
  TOPLANTI: "Toplantı planlandı",
  SONUC: "Sonuç tutanağı düzenlendi",
  ANLASMA: "Anlaşma sağlandı",
  ANLASMA_YOK: "Anlaşma sağlanamadı",
  DAVA_ACILDI: "Dava açıldı",
  FERAGAT: "Arabuluculuktan feragat/vazgeçme",
};

/** Geçerli durum geçişleri — serbest atlamayı engeller. */
const ALLOWED: Record<MediationStatus, readonly MediationStatus[]> = {
  DAVET: ["TOPLANTI", "FERAGAT", "SONUC"],
  TOPLANTI: ["SONUC", "TOPLANTI", "FERAGAT"],
  SONUC: ["ANLASMA", "ANLASMA_YOK"],
  ANLASMA: [],
  ANLASMA_YOK: ["DAVA_ACILDI"],
  DAVA_ACILDI: [],
  FERAGAT: [],
};

@Injectable()
export class MediationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly deadlines: DeadlinesService,
  ) {}

  async list(user: AuthUser, filters: { status?: string; caseId?: string }) {
    return this.prisma.client.mediation.findMany({
      where: {
        tenantId: user.tenantId,
        ...(filters.status && (MEDIATION_STATUSES as readonly string[]).includes(filters.status)
          ? { status: filters.status }
          : {}),
        ...(filters.caseId ? { caseId: filters.caseId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        case: { select: { id: true, title: true, fileNumber: true } },
      },
    });
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.prisma.client.mediation.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        case: { select: { id: true, title: true, fileNumber: true } },
      },
    });
    if (!row) throw new NotFoundException("Arabuluculuk kaydı bulunamadı.");
    return row;
  }

  async create(
    user: AuthUser,
    input: {
      title: string;
      caseId?: string;
      clientId?: string;
      meetingAt?: string | null;
      note?: string;
    },
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "arabuluculuk kaydı oluşturma");
    if (input.caseId) {
      const c = await this.prisma.client.case.findFirst({
        where: { id: input.caseId, tenantId: user.tenantId },
        select: { id: true },
      });
      if (!c) throw new NotFoundException("Dosya bulunamadı.");
    }
    if (input.clientId) {
      const c = await this.prisma.client.client.findFirst({
        where: { id: input.clientId, tenantId: user.tenantId },
        select: { id: true },
      });
      if (!c) throw new NotFoundException("Müvekkil bulunamadı.");
    }
    const created = await this.prisma.client.mediation.create({
      data: {
        tenantId: user.tenantId,
        caseId: input.caseId ?? null,
        clientId: input.clientId ?? null,
        title: input.title.trim(),
        status: "DAVET",
        ...(input.meetingAt ? { meetingAt: new Date(input.meetingAt) } : {}),
        note: input.note?.trim() || null,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "MEDIATION_CREATE",
      entity: "Mediation",
      entityId: created.id,
      detail: `${created.title}${input.caseId ? ` · dosya ${input.caseId}` : ""}`,
    });
    return created;
  }

  /**
   * Durum geçişi — ANLASMA_YOK özel: son tutanak tarihi zorunludur ve 6325 m.18
   * uyarınca 2 haftalık dava süresi otomatik hesaplanır (kural motorundan).
   */
  async transition(
    user: AuthUser,
    id: string,
    input: {
      status: string;
      meetingAt?: string | null;
      finalProtocolAt?: string | null;
      settlementAmount?: number | null;
      note?: string | null;
      caseId?: string;
    },
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "arabuluculuk durumu değiştirme");
    const existing = await this.prisma.client.mediation.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException("Arabuluculuk kaydı bulunamadı.");
    const next = input.status as MediationStatus;
    if (!(MEDIATION_STATUSES as readonly string[]).includes(next)) {
      throw new BadRequestException("Geçersiz durum.");
    }
    const allowed = ALLOWED[existing.status as MediationStatus] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `"${STATUS_LABELS[existing.status as MediationStatus]}" durumundan "${STATUS_LABELS[next]}" durumuna geçilemez.`,
      );
    }

    let lawsuitDeadlineId: string | null = existing.lawsuitDeadlineId;
    const caseId = input.caseId ?? existing.caseId ?? undefined;

    // ANLASMA_YOK: son tutanak tarihi şart + 2 haftalık dava süresi üret.
    if (next === "ANLASMA_YOK") {
      const finalProtocolAt = input.finalProtocolAt ? new Date(input.finalProtocolAt) : existing.finalProtocolAt;
      if (!finalProtocolAt) {
        throw new BadRequestException(
          "Anlaşma yoksa SON TUTANAK tarihi zorunludur — 2 haftalık dava süresi bu tarihten hesaplanır (6325 s.K. m.18).",
        );
      }
      if (!caseId) {
        throw new BadRequestException(
          "Dava süresi hesaplamak için arabuluculuk kaydı bir DOSYAYA bağlı olmalıdır; dosya seçin.",
        );
      }
      const deadline = await this.deadlines.createFromRule(user, {
        caseId,
        ruleKey: "ARABULUCULUK_DAVA",
        triggerDate: finalProtocolAt,
        title: "Arabuluculuk sonrası dava açma süresi (anlaşma yok)",
      });
      lawsuitDeadlineId = deadline.deadline.id;
    }

    const updated = await this.prisma.client.mediation.update({
      where: { id },
      data: {
        status: next,
        ...(input.meetingAt !== undefined ? { meetingAt: input.meetingAt ? new Date(input.meetingAt) : null } : {}),
        ...(input.finalProtocolAt !== undefined
          ? { finalProtocolAt: input.finalProtocolAt ? new Date(input.finalProtocolAt) : null }
          : {}),
        ...(input.settlementAmount !== undefined && input.settlementAmount !== null
          ? { settlementAmount: new Prisma.Decimal(input.settlementAmount.toFixed(2)) }
          : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
        lawsuitDeadlineId,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "MEDIATION_TRANSITION",
      entity: "Mediation",
      entityId: id,
      detail: `${STATUS_LABELS[existing.status as MediationStatus]} → ${STATUS_LABELS[next]}${
        lawsuitDeadlineId ? ` · dava süresi üretildi (${lawsuitDeadlineId.slice(0, 8)}…)` : ""
      }`,
    });
    return { ...updated, lawsuitDeadlineId };
  }
}
