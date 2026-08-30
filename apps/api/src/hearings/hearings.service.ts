import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { HearingStatus as DbHearingStatus, Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { assertRole, ROLE_SETS } from "../common/roles";
import { parseDateParam, parseRangeEnd } from "../common/dates";
import { paged, resolvePage } from "../common/pagination";
import { refreshCaseDenormals } from "../common/case-denormals";
import { HEARING_STATUSES, type CreateHearingInput, type HearingResultInput, type UpdateHearingInput } from "./hearings.dto";

const CASE_SELECT = {
  id: true,
  title: true,
  fileNumber: true,
  courtName: true,
  type: true,
  status: true,
  client: { select: { id: true, name: true } },
  responsibleUser: { select: { id: true, fullName: true } },
} satisfies Prisma.CaseSelect;

@Injectable()
export class HearingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /** GET /hearings — tarih aralığı + dosya + durum süzgeçleri. */
  async list(
    tenantId: string,
    params: { from?: string; to?: string; caseId?: string; status?: string; page?: string; limit?: string }
  ) {
    const where: Prisma.HearingWhereInput = { tenantId };
    const pageParams = resolvePage(params);

    const dateFilter: Prisma.DateTimeFilter = {};
    if (params.from) dateFilter.gte = parseDateParam(params.from, "from");
    // Duruşma kayıtları saat bileşeni taşır; `to` GÜN SONUNA genişletilmezse
    // aralığın son gününe ait tüm duruşmalar sonuçtan düşer (denetim bulgusu 10).
    if (params.to) dateFilter.lte = parseRangeEnd(params.to, "to");
    if (params.from || params.to) where.date = dateFilter;

    if (params.caseId) where.caseId = params.caseId;
    if (params.status) {
      if (!(HEARING_STATUSES as readonly string[]).includes(params.status)) {
        throw new BadRequestException("Geçersiz duruşma durumu.");
      }
      where.status = params.status as DbHearingStatus;
    }

    const [items, total] = await Promise.all([
      this.prisma.client.hearing.findMany({
        where,
        orderBy: { date: "asc" },
        include: { case: { select: CASE_SELECT } },
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.hearing.count({ where }),
    ]);
    return paged(items, total, pageParams);
  }

  async detail(tenantId: string, id: string) {
    const hearing = await this.prisma.client.hearing.findFirst({
      where: { id, tenantId },
      include: { case: { select: CASE_SELECT } },
    });
    if (!hearing) {
      throw new NotFoundException("Duruşma bulunamadı.");
    }
    return hearing;
  }

  /** POST /hearings */
  async create(user: AuthUser, input: CreateHearingInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "duruşma kaydı oluşturma");
    const relatedCase = await this.requireCase(user.tenantId, input.caseId);

    const hearing = await this.prisma.client.hearing.create({
      data: {
        tenantId: user.tenantId,
        caseId: input.caseId,
        type: input.type,
        status: input.status,
        date: input.date,
        courtroom: input.courtroom ?? undefined,
        note: input.note ?? undefined,
        prepSummary: input.prepSummary ?? undefined,
        preparedAt: input.prepSummary ? new Date() : undefined,
      },
      include: { case: { select: CASE_SELECT } },
    });

    await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId: input.caseId,
        userId: user.userId,
        date: new Date(),
        title: `Duruşma günü verildi: ${input.date.toISOString().slice(0, 10)}`,
        detail: input.courtroom ? `Salon: ${input.courtroom}` : undefined,
        source: "SISTEM",
      },
    });
    await refreshCaseDenormals(this.prisma.client, input.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "HEARING_CREATE",
      entity: "Hearing",
      entityId: hearing.id,
      detail: `${relatedCase.fileNumber ?? relatedCase.title} — ${input.date.toISOString()}`,
    });
    return hearing;
  }

  /** PATCH /hearings/:id */
  async update(user: AuthUser, id: string, input: UpdateHearingInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "duruşma güncelleme");
    const existing = await this.requireHearing(user.tenantId, id);

    const data: Prisma.HearingUncheckedUpdateInput = { ...(input as Prisma.HearingUncheckedUpdateInput) };
    if (input.prepSummary && !existing.preparedAt) {
      data.preparedAt = new Date();
    }

    const hearing = await this.prisma.client.hearing.update({
      where: { id },
      data,
      include: { case: { select: CASE_SELECT } },
    });

    if (input.date && input.date.getTime() !== existing.date.getTime()) {
      await this.prisma.client.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: existing.caseId,
          userId: user.userId,
          date: new Date(),
          title: `Duruşma tarihi değişti: ${existing.date.toISOString().slice(0, 10)} → ${input.date
            .toISOString()
            .slice(0, 10)}`,
          source: "SISTEM",
        },
      });
    }
    await refreshCaseDenormals(this.prisma.client, existing.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "HEARING_UPDATE",
      entity: "Hearing",
      entityId: id,
      detail: Object.keys(input).join(", "),
    });
    return hearing;
  }

  /** PATCH /hearings/:id/result — sonuç + safahat kaydı (+ opsiyonel yeni duruşma) */
  async setResult(user: AuthUser, id: string, input: HearingResultInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "duruşma sonucu girme");
    const existing = await this.requireHearing(user.tenantId, id);

    if (existing.status === "IPTAL") {
      throw new BadRequestException("İptal edilmiş duruşmaya sonuç girilemez.");
    }
    if (input.status === "ERTELENDI" && !input.nextDate) {
      throw new BadRequestException("Erteleme kaydı için sonraki duruşma tarihi girilmelidir.");
    }

    const statusLabel =
      input.status === "YAPILDI" ? "Duruşma yapıldı" : input.status === "ERTELENDI" ? "Duruşma ertelendi" : "Duruşma iptal edildi";

    const result = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.hearing.update({
        where: { id },
        data: { status: input.status, note: input.note },
      });

      let nextHearing: Awaited<ReturnType<typeof tx.hearing.create>> | null = null;
      if (input.nextDate) {
        nextHearing = await tx.hearing.create({
          data: {
            tenantId: user.tenantId,
            caseId: existing.caseId,
            type: input.nextType ?? existing.type,
            status: "PLANLANDI",
            date: input.nextDate,
            courtroom: input.nextCourtroom ?? existing.courtroom,
          },
        });
      }

      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: existing.caseId,
          userId: user.userId,
          date: existing.date,
          title: `${statusLabel} — ${existing.date.toISOString().slice(0, 10)}`,
          detail: input.nextDate
            ? `${input.note}\nSonraki duruşma: ${input.nextDate.toISOString().slice(0, 10)}`
            : input.note,
          source: "SISTEM",
        },
      });

      return { hearing: updated, nextHearing };
    });

    await refreshCaseDenormals(this.prisma.client, existing.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "HEARING_RESULT",
      entity: "Hearing",
      entityId: id,
      detail: `${input.status} — ${input.note.slice(0, 120)}`,
    });
    return result;
  }

  /** DELETE /hearings/:id */
  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "duruşma silme");
    const existing = await this.requireHearing(user.tenantId, id);
    if (existing.status === "YAPILDI") {
      throw new BadRequestException("Yapılmış duruşma silinemez; kayıt üzerinde düzeltme yapın.");
    }

    await this.prisma.client.hearing.delete({ where: { id } });
    await refreshCaseDenormals(this.prisma.client, existing.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "HEARING_DELETE",
      entity: "Hearing",
      entityId: id,
      detail: existing.date.toISOString(),
    });
    return { ok: true, id };
  }

  private async requireHearing(tenantId: string, id: string) {
    const hearing = await this.prisma.client.hearing.findFirst({
      where: { id, tenantId },
      select: { id: true, caseId: true, date: true, status: true, type: true, courtroom: true, preparedAt: true },
    });
    if (!hearing) {
      throw new NotFoundException("Duruşma bulunamadı.");
    }
    return hearing;
  }

  private async requireCase(tenantId: string, caseId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, title: true, fileNumber: true },
    });
    if (!found) {
      throw new BadRequestException("Dosya bulunamadı.");
    }
    return found;
  }
}
