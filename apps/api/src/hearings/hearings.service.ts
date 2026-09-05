import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { HearingStatus as DbHearingStatus, Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { relatedCaseVisibilityWhere } from "../common/case-visibility";
import type { AuthUser } from "../common/types";
import { assertRole, ROLE_SETS } from "../common/roles";
import { parseDateParam, parseRangeEnd } from "../common/dates";
import { paged, resolvePage } from "../common/pagination";
import { refreshCaseDenormals } from "../common/case-denormals";
import { HEARING_STATUSES, type CreateHearingInput, type HearingPrepInput, type HearingResultInput, type UpdateHearingInput } from "./hearings.dto";
import { HearingPrepOutputSchema, buildHearingPrepMessages } from "@nomosos/legal-ai";
import { AssistantLlmService } from "../assistant/assistant-llm.service";
import { CaseContextBuilder } from "../assistant/case-context.builder";
import { RetrievalService } from "../assistant/retrieval.service";

/** Çakışma penceresi: aynı avukat, ±2 saat (adliyeler arası yol dâhil). */
const ATTENDEE_CONFLICT_WINDOW_MS = 2 * 3_600_000;
const PREP_CONTEXT_BUDGET = 3000;
const PREP_CHUNK_BUDGET = 5000;

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

/** Liste/detay yanıtı: dosya künyesi + sorumlu avukat (Faz 1). */
const HEARING_INCLUDE = {
  case: { select: CASE_SELECT },
  attendee: { select: { id: true, fullName: true } },
} satisfies Prisma.HearingInclude;

@Injectable()
export class HearingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: AssistantLlmService,
    private readonly contextBuilder: CaseContextBuilder,
    private readonly retrieval: RetrievalService,
  ) {}

  /* ---------------- Faz 1: sorumlu avukat + çakışma ---------------- */

  /** Sorumlu avukat bu büroda aktif bir kullanıcı olmalı; null = atanmamış. */
  private async resolveAttendee(tenantId: string, id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    const u = await this.prisma.client.user.findFirst({ where: { id, tenantId, isActive: true }, select: { id: true } });
    if (!u) throw new BadRequestException("Sorumlu avukat bu büroda aktif bir kullanıcı olmalıdır.");
    return u.id;
  }

  /**
   * ÇAKIŞMA KONTROLÜ: aynı avukatın ±2 saat içinde iptal edilmemiş başka
   * duruşması varsa 409 (sekreter iki celseyi üst üste yazamaz). Bilinçli
   * ekleme `force: true` ile geçer; karar avukatındır, sistem yalnız uyarır.
   */
  private async assertNoAttendeeConflict(
    tenantId: string,
    attendeeUserId: string | null,
    date: Date,
    excludeId: string | null,
    force?: boolean,
  ): Promise<void> {
    if (!attendeeUserId || force) return;
    const clash = await this.prisma.client.hearing.findFirst({
      where: {
        tenantId,
        attendeeUserId,
        date: { gte: new Date(date.getTime() - ATTENDEE_CONFLICT_WINDOW_MS), lte: new Date(date.getTime() + ATTENDEE_CONFLICT_WINDOW_MS) },
        status: { not: "IPTAL" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      include: { case: { select: { title: true, fileNumber: true, courtName: true } } },
      orderBy: { date: "asc" },
    });
    if (clash) {
      const when = clash.date.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
      throw new ConflictException(
        `Çakışma: sorumlu avukatın ${when} tarihinde "${clash.case.title}" duruşması var` +
          `${clash.case.courtName ? ` (${clash.case.courtName})` : ""}. ` +
          "Bilerek ekliyorsanız çakışmayı onaylayarak kaydedin (force).",
      );
    }
  }

  /** Tarihi geçmiş ama sonucu girilmemiş duruşmalar (disiplin listesi). */
  async pendingResults(tenantId: string, viewer?: AuthUser) {
    const items = await this.prisma.client.hearing.findMany({
      where: {
        tenantId,
        ...(viewer ? relatedCaseVisibilityWhere(viewer) : {}),
        status: "PLANLANDI",
        date: { lt: new Date() },
      },
      orderBy: { date: "desc" },
      take: 100,
      include: HEARING_INCLUDE,
    });
    return { items, total: items.length };
  }

  /* ---------------- Faz 1: HEARING_PREP hazırlık paketi ---------------- */

  /**
   * "Duruşmayı hazırla": 9 sabit bölümlü paket (packages/legal-ai hearing-prep).
   * Prompt, şema, ajan kaydı ve kredi fiyatı vardı; çağıran uç yoktu (ölü özellik).
   * Bağlam = dosya künyesi + RAG parçaları; çıktı output-guard'dan geçer, Hearing.prepJson'a yazılır.
   */
  async prepare(user: AuthUser, id: string, input: HearingPrepInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "duruşma hazırlık paketi üretme");
    const hearing = await this.prisma.client.hearing.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { case: { select: { id: true, title: true, fileNumber: true, courtName: true } } },
    });
    if (!hearing) throw new NotFoundException("Duruşma bulunamadı.");

    const context = await this.contextBuilder.buildFor(user.tenantId, hearing.caseId, "HEARING_PREP", PREP_CONTEXT_BUDGET);
    const query = [context.caseTitle, context.caseFileNumber, "duruşma ara karar tanık bilirkişi delil süre"].filter(Boolean).join(" ");
    const retrieved = await this.retrieval.retrieveContext(user.tenantId, hearing.caseId, query, {
      topK: 12,
      tokenBudget: PREP_CHUNK_BUDGET,
    });
    const chunkBlock = retrieved.chunks.length
      ? retrieved.chunks.map((c, i) => `[BELGE ${i + 1}] ${c.sourceLabel} (id: ${c.documentId})\n${c.content}`).join("\n\n")
      : "(İndekslenmiş belge parçası bulunamadı.)";

    const messages = buildHearingPrepMessages({
      hearingDate: hearing.date.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }),
      courtName: hearing.case.courtName ?? "Mahkeme belirtilmemiş",
      hearingType: hearing.type,
      purpose: hearing.note ?? undefined,
      caseContextText: `${context.built.text}\n\nBAĞLAM PARÇALARI:\n${chunkBlock}`,
    });

    const run = await this.llm.runTask({
      user,
      routeKeys: ["HEARING_PREP", "CASE_FULL_ANALYSIS", "CASE_CHAT"],
      logTaskType: "HEARING_PREP",
      messages,
      schema: HearingPrepOutputSchema,
      findingPaths: [],
      piiApproved: input.piiApproved,
      maxTokens: 8192,
      auditDetail: `hearingId=${id} caseId=${hearing.caseId} parca=${retrieved.chunks.length}`,
      policyOverrides: context.built.policyOverrides,
    });

    const prepJson = JSON.stringify(run.data);
    await this.prisma.client.hearing.update({ where: { id }, data: { prepJson, preparedAt: new Date() } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "HEARING_PREP",
      entity: "Hearing",
      entityId: id,
      detail: `model=${run.model} parca=${retrieved.chunks.length} dosya=${hearing.case.fileNumber ?? hearing.case.title}`,
    });
    const sections = run.data.sections;
    const unsourced = Object.entries(sections)
      .filter(([, s]) => !s.noData && (!s.sourceRefs || s.sourceRefs.length === 0))
      .map(([k]) => k);
    return {
      hearingId: id,
      prep: run.data,
      model: run.model,
      advisory: run.advisory,
      warnings: unsourced.length ? [`Kaynaksız (teyitsiz) bölümler: ${unsourced.join(", ")}`] : [],
      retrievalMode: retrieved.mode,
    };
  }

  /** GET /hearings — tarih aralığı + dosya + durum süzgeçleri. */
  async list(
    tenantId: string,
    params: { from?: string; to?: string; caseId?: string; status?: string; page?: string; limit?: string; attendeeUserId?: string },
    viewer?: AuthUser
  ) {
    const where: Prisma.HearingWhereInput = { tenantId, ...(viewer ? relatedCaseVisibilityWhere(viewer) : {}) };
    const pageParams = resolvePage(params);

    const dateFilter: Prisma.DateTimeFilter = {};
    if (params.from) dateFilter.gte = parseDateParam(params.from, "from");
    // Duruşma kayıtları saat bileşeni taşır; `to` GÜN SONUNA genişletilmezse
    // aralığın son gününe ait tüm duruşmalar sonuçtan düşer (denetim bulgusu 10).
    if (params.to) dateFilter.lte = parseRangeEnd(params.to, "to");
    if (params.from || params.to) where.date = dateFilter;

    if (params.caseId) where.caseId = params.caseId;
    if (params.attendeeUserId) where.attendeeUserId = params.attendeeUserId;
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
        include: HEARING_INCLUDE,
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
      include: HEARING_INCLUDE,
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

    // F2-Ö-08 (Modül 03, kural 1 + KK11): aynı dosyada aynı GÜN celse mükerrer
    // olamaz (409) ve geçmiş tarihe duruşma açılamaz (400).
    const hearingDayStart = new Date(input.date);
    hearingDayStart.setUTCHours(0, 0, 0, 0);
    const hearingDayEnd = new Date(hearingDayStart.getTime() + 86_400_000);

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    if (hearingDayStart.getTime() < todayStart.getTime()) {
      throw new BadRequestException(
        "Geçmiş tarihe duruşma kaydı açılamaz. Tarih/saati kontrol edin; geçmiş oturum " +
          "için sonucu mevcut kayıt üzerinden güncelleyin.",
      );
    }

    const duplicate = await this.prisma.client.hearing.findFirst({
      where: {
        tenantId: user.tenantId,
        caseId: input.caseId,
        date: { gte: hearingDayStart, lt: hearingDayEnd },
        NOT: { status: "IPTAL" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        "Bu dosyada aynı güne zaten bir duruşma kaydı var. Aynı gün ikinci bir oturum " +
          "gerçekten varsa not alanına ayırt edici bilgi girin veya mevcut kaydı güncelleyin.",
      );
    }

    // Faz 1: sorumlu avukat + çakışma kontrolü.
    const attendeeUserId = await this.resolveAttendee(user.tenantId, input.attendeeUserId);
    await this.assertNoAttendeeConflict(user.tenantId, attendeeUserId, input.date, null, input.force);

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
        attendeeUserId,
      },
      include: HEARING_INCLUDE,
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

    // `force` ve `attendeeUserId` veri değil, karar alanlarıdır — ayrı işlenir.
    const { force, attendeeUserId: attendeeInput, ...rest } = input;
    const data: Prisma.HearingUncheckedUpdateInput = { ...(rest as Prisma.HearingUncheckedUpdateInput) };
    if (input.prepSummary && !existing.preparedAt) {
      data.preparedAt = new Date();
    }
    if (attendeeInput !== undefined) {
      data.attendeeUserId = await this.resolveAttendee(user.tenantId, attendeeInput);
    }
    if (attendeeInput !== undefined || input.date) {
      const effectiveAttendee = attendeeInput !== undefined ? (data.attendeeUserId as string | null) : existing.attendeeUserId;
      await this.assertNoAttendeeConflict(user.tenantId, effectiveAttendee, input.date ?? existing.date, id, force);
    }

    const hearing = await this.prisma.client.hearing.update({
      where: { id },
      data,
      include: HEARING_INCLUDE,
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
      select: { id: true, caseId: true, date: true, status: true, type: true, courtroom: true, preparedAt: true, attendeeUserId: true },
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
