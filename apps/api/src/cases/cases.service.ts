import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CaseStatus as DbCaseStatus, CaseType as DbCaseType, Prisma } from "@nomosos/db";
import { CASE_STATUSES, CASE_TYPES, type CaseStatus, type CreateCaseInput } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { assertRole, hasRole, ROLE_SETS } from "../common/roles";
import { refreshCaseDenormals, touchCase } from "../common/case-denormals";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { assertCaseStatusTransition, CASE_STATUS_TRANSITIONS, CLOSING_STATUSES } from "./case-status";
import type {
  ChangeCaseStatusInput,
  CreateCaseDecisionInput,
  CreateCaseNoteInput,
  CreateCasePartyInput,
  CreateTimelineEventInput,
  UpdateCaseInput,
  UpdateCaseNoteInput,
} from "./cases.dto";

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list(
    tenantId: string,
    params: {
      status?: string;
      type?: string;
      q?: string;
      clientId?: string;
      responsibleUserId?: string;
      page?: string;
      limit?: string;
    }
  ) {
    const where: Prisma.CaseWhereInput = { tenantId };
    const pageParams = resolvePage(params);

    if (params.status) {
      if (!(CASE_STATUSES as readonly string[]).includes(params.status)) {
        throw new BadRequestException("Geçersiz dosya durumu.");
      }
      where.status = params.status as DbCaseStatus;
    }
    if (params.type) {
      if (!(CASE_TYPES as readonly string[]).includes(params.type)) {
        throw new BadRequestException("Geçersiz dosya türü.");
      }
      where.type = params.type as DbCaseType;
    }
    if (params.clientId) where.clientId = params.clientId;
    if (params.responsibleUserId) where.responsibleUserId = params.responsibleUserId;
    const q = normalizeQuery(params.q);
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { fileNumber: { contains: q, mode: "insensitive" } },
        { courtName: { contains: q, mode: "insensitive" } },
        { client: { name: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.case.findMany({
        where,
        orderBy: { openedAt: "desc" },
        include: {
          client: { select: { id: true, name: true } },
          responsibleUser: { select: { id: true, fullName: true } },
          _count: { select: { hearings: true, deadlines: true, tasks: true, documents: true } },
        },
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.case.count({ where }),
    ]);
    return paged(items, total, pageParams);
  }

  async create(user: AuthUser, input: CreateCaseInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "dosya açma");
    const client = await this.prisma.client.client.findFirst({
      where: { id: input.clientId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!client) {
      throw new BadRequestException("Müvekkil bulunamadı. Önce müvekkil kaydı oluşturun.");
    }
    if (input.responsibleUserId) {
      await this.requireTenantUser(user.tenantId, input.responsibleUserId);
    }

    const created = await this.prisma.client.case.create({
      data: { tenantId: user.tenantId, ...input, lastActivityAt: new Date() },
    });
    await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId: created.id,
        userId: user.userId,
        title: "Dosya açıldı",
        detail: created.fileNumber ? `Esas no: ${created.fileNumber}` : undefined,
        source: "SISTEM",
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_CREATE",
      entity: "Case",
      entityId: created.id,
      detail: created.title,
    });
    return created;
  }

  async detail(tenantId: string, id: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id, tenantId },
      include: {
        client: { select: { id: true, name: true, type: true, phone: true, email: true } },
        responsibleUser: { select: { id: true, fullName: true } },
        parties: true,
        hearings: { orderBy: { date: "desc" } },
        deadlines: { orderBy: { dueDate: "asc" }, include: { owner: { select: { id: true, fullName: true } } } },
        tasks: {
          orderBy: { createdAt: "desc" },
          include: { assignee: { select: { id: true, fullName: true } } },
        },
        documents: { orderBy: { createdAt: "desc" } },
        timelineEvents: {
          orderBy: { date: "desc" },
          include: { user: { select: { id: true, fullName: true } } },
        },
        notes: {
          orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
          include: { user: { select: { id: true, fullName: true } } },
        },
        decisions: { orderBy: { date: "desc" } },
      },
    });
    if (!found) {
      throw new NotFoundException("Dosya bulunamadı.");
    }
    return {
      ...found,
      allowedStatusTransitions: CASE_STATUS_TRANSITIONS[found.status as CaseStatus] ?? [],
    };
  }

  /** PATCH /cases/:id */
  async update(user: AuthUser, id: string, input: UpdateCaseInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "dosya bilgisi güncelleme");
    const existing = await this.requireCase(user.tenantId, id);

    if (input.responsibleUserId) {
      await this.requireTenantUser(user.tenantId, input.responsibleUserId);
    }

    const updated = await this.prisma.client.case.update({
      where: { id: existing.id },
      data: { ...(input as Prisma.CaseUncheckedUpdateInput), lastActivityAt: new Date() },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_UPDATE",
      entity: "Case",
      entityId: id,
      detail: `${this.caseLabel(existing)} — güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return updated;
  }

  /** PATCH /cases/:id/status — durum geçişi + safahat kaydı */
  async changeStatus(user: AuthUser, id: string, input: ChangeCaseStatusInput) {
    if (hasRole(user, ["SEKRETER"])) {
      throw new ForbiddenException("Sekreter rolü dosya durumu değiştiremez.");
    }
    const existing = await this.requireCase(user.tenantId, id);
    const label = this.caseLabel(existing);
    const from = existing.status as CaseStatus;
    const to = input.status;

    if (CLOSING_STATUSES.includes(to) && hasRole(user, ["STAJYER"])) {
      throw new ForbiddenException("Stajyer rolü dosya kapatma yetkisine sahip değil.");
    }
    assertCaseStatusTransition(label, from, to);

    if (CLOSING_STATUSES.includes(to)) {
      await this.assertClosable(user, id, label, input.force);
    }

    const now = new Date();
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.case.update({
        where: { id },
        data: {
          status: to as DbCaseStatus,
          closedAt: CLOSING_STATUSES.includes(to) ? (existing.closedAt ?? now) : null,
          lastActivityAt: now,
        },
      });
      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: id,
          userId: user.userId,
          date: now,
          title: `Dosya durumu değişti: ${from} → ${to}`,
          detail: input.note ?? undefined,
          source: "SISTEM",
        },
      });
      return result;
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_STATUS_CHANGE",
      entity: "Case",
      entityId: id,
      detail: `${label}: ${from} → ${to}${input.note ? ` (${input.note})` : ""}`,
    });
    return updated;
  }

  // ---------- Safahat ----------

  async listTimeline(tenantId: string, caseId: string) {
    await this.requireCase(tenantId, caseId);
    return this.prisma.client.timelineEvent.findMany({
      where: { caseId, tenantId },
      orderBy: { date: "desc" },
      include: { user: { select: { id: true, fullName: true } } },
    });
  }

  /** POST /cases/:id/timeline — manuel safahat kaydı */
  async createTimelineEvent(user: AuthUser, caseId: string, input: CreateTimelineEventInput) {
    // Safahat, dosyanın resmî hukuki kronolojisidir; karar ve taraf yazımıyla
    // aynı yetki seviyesinde olmalıdır (denetim bulgusu 18). Notlar serbest
    // kalır — onların silme/düzenlemesi zaten sahiplik kontrollüdür.
    assertRole(user, ROLE_SETS.OPERASYON, "safahat kaydı ekleme");
    await this.requireCase(user.tenantId, caseId);
    const date = input.date ?? new Date();

    const event = await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        userId: user.userId,
        date,
        title: input.title,
        detail: input.detail ?? undefined,
        source: "MANUEL",
      },
      include: { user: { select: { id: true, fullName: true } } },
    });
    await touchCase(this.prisma.client, caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_TIMELINE_CREATE",
      entity: "TimelineEvent",
      entityId: event.id,
      detail: event.title,
    });
    return event;
  }

  // ---------- Notlar ----------

  async listNotes(tenantId: string, caseId: string) {
    await this.requireCase(tenantId, caseId);
    return this.prisma.client.caseNote.findMany({
      where: { caseId, tenantId },
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      include: { user: { select: { id: true, fullName: true } } },
    });
  }

  async createNote(user: AuthUser, caseId: string, input: CreateCaseNoteInput) {
    await this.requireCase(user.tenantId, caseId);

    const note = await this.prisma.client.caseNote.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        userId: user.userId,
        content: input.content,
        isPinned: input.isPinned,
      },
      include: { user: { select: { id: true, fullName: true } } },
    });
    await touchCase(this.prisma.client, caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_NOTE_CREATE",
      entity: "CaseNote",
      entityId: note.id,
      detail: note.content.slice(0, 120),
    });
    return note;
  }

  async updateNote(user: AuthUser, noteId: string, input: UpdateCaseNoteInput) {
    const note = await this.requireNote(user.tenantId, noteId);
    if (note.userId !== user.userId && !hasRole(user, ROLE_SETS.ONAY)) {
      throw new ForbiddenException("Başkasının notunu yalnızca ortak veya yönetici düzenleyebilir.");
    }

    const updated = await this.prisma.client.caseNote.update({
      where: { id: noteId },
      data: input,
      include: { user: { select: { id: true, fullName: true } } },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_NOTE_UPDATE",
      entity: "CaseNote",
      entityId: noteId,
      detail: Object.keys(input).join(", "),
    });
    return updated;
  }

  /** DELETE /notes/:id */
  async removeNote(user: AuthUser, noteId: string) {
    const note = await this.requireNote(user.tenantId, noteId);
    if (note.userId !== user.userId && !hasRole(user, ROLE_SETS.ONAY)) {
      throw new ForbiddenException("Başkasının notunu yalnızca ortak veya yönetici silebilir.");
    }

    await this.prisma.client.caseNote.delete({ where: { id: noteId } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_NOTE_DELETE",
      entity: "CaseNote",
      entityId: noteId,
      detail: note.content.slice(0, 120),
    });
    return { ok: true, id: noteId };
  }

  // ---------- Kararlar ----------

  async listDecisions(tenantId: string, caseId: string) {
    await this.requireCase(tenantId, caseId);
    return this.prisma.client.caseDecision.findMany({
      where: { caseId, tenantId },
      orderBy: { date: "desc" },
    });
  }

  async createDecision(user: AuthUser, caseId: string, input: CreateCaseDecisionInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "karar kaydı ekleme");
    await this.requireCase(user.tenantId, caseId);

    const decision = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.caseDecision.create({
        data: {
          tenantId: user.tenantId,
          caseId,
          type: input.type,
          date: input.date,
          summary: input.summary,
          outcome: input.outcome ?? undefined,
          documentId: input.documentId ?? undefined,
        },
      });
      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId,
          userId: user.userId,
          date: input.date,
          title: `Karar kaydedildi: ${input.type}`,
          detail: input.outcome ? `${input.summary} (${input.outcome})` : input.summary,
          source: "SISTEM",
        },
      });
      return created;
    });

    await touchCase(this.prisma.client, caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_DECISION_CREATE",
      entity: "CaseDecision",
      entityId: decision.id,
      detail: `${decision.type} — ${decision.summary.slice(0, 100)}`,
    });
    return decision;
  }

  // ---------- Taraflar ----------

  async createParty(user: AuthUser, caseId: string, input: CreateCasePartyInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "taraf ekleme");
    await this.requireCase(user.tenantId, caseId);

    // D8 — taraf büro müvekkiliyse KARTTAN bağlanır; ad SUNUCUDA karttan
    // doldurulur (kullanıcı adı elle yazamaz — seçim ilkesi). Kartsız
    // "müvekkilimiz" işaretiyle elle yazılan taraf, çatışma kontrolünü ve
    // finans özetlerini kandıran sessiz bir kopukluk üretirdi.
    const clientId = input.clientId ?? null;
    let name = input.name.trim();
    if (clientId) {
      const client = await this.prisma.client.client.findFirst({
        where: { id: clientId, tenantId: user.tenantId },
        select: { id: true, name: true },
      });
      if (!client) throw new NotFoundException("Bağlanacak müvekkil kartı bulunamadı.");
      name = client.name;
    } else if (input.isClient) {
      throw new BadRequestException(
        "Müvekkil taraf, müvekkil kartından SEÇİLEREK eklenir (ad elle yazılamaz). " +
          "Karşı taraf için müvekkil işaretini kaldırın."
      );
    }

    const party = await this.prisma.client.caseParty.create({
      data: {
        caseId,
        role: input.role,
        name,
        isClient: input.isClient,
        clientId,
        lawyerName: input.lawyerName ?? undefined,
        notes: input.notes ?? undefined,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_PARTY_CREATE",
      entity: "CaseParty",
      entityId: party.id,
      detail: `${party.role}: ${party.name}${clientId ? " (müvekkil kartına bağlı)" : ""}`,
    });
    return party;
  }

  // ---------- Yardımcılar ----------

  /** Duruşma modülünün de kullanabilmesi için dışa açık. */
  async refreshDenormals(caseId: string): Promise<void> {
    await refreshCaseDenormals(this.prisma.client, caseId);
  }

  private caseLabel(found: { fileNumber: string | null; title: string }): string {
    return found.fileNumber ?? found.title;
  }

  private async requireCase(tenantId: string, id: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id, tenantId },
      select: { id: true, title: true, fileNumber: true, status: true, closedAt: true },
    });
    if (!found) {
      throw new NotFoundException("Dosya bulunamadı.");
    }
    return found;
  }

  private async requireNote(tenantId: string, noteId: string) {
    const note = await this.prisma.client.caseNote.findFirst({
      where: { id: noteId, tenantId },
      select: { id: true, userId: true, caseId: true, content: true },
    });
    if (!note) {
      throw new NotFoundException("Not bulunamadı.");
    }
    return note;
  }

  private async requireTenantUser(tenantId: string, userId: string) {
    const found = await this.prisma.client.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });
    if (!found) {
      throw new BadRequestException("Seçilen kullanıcı büronuzda bulunamadı.");
    }
    return found;
  }

  /** Modül 02 — kural 4: açık süre veya görev varken dosya kapatılamaz. */
  private async assertClosable(user: AuthUser, caseId: string, label: string, force: boolean) {
    const [openDeadlines, openTasks] = await Promise.all([
      this.prisma.client.deadline.findMany({
        where: { caseId, tenantId: user.tenantId, status: { in: ["BEKLIYOR", "ONAYLANDI"] } },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
      }),
      this.prisma.client.task.findMany({
        where: { caseId, tenantId: user.tenantId, status: { notIn: ["TAMAMLANDI", "IPTAL"] } },
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    if (openDeadlines.length === 0 && openTasks.length === 0) return;

    if (force && hasRole(user, ROLE_SETS.ONAY)) {
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "CASE_CLOSE_FORCED",
        entity: "Case",
        entityId: caseId,
        detail: `${label}: ${openDeadlines.length} açık süre, ${openTasks.length} açık görev yok sayıldı.`,
      });
      return;
    }

    throw new BadRequestException({
      message:
        `${label} dosyası kapatılamaz: ${openDeadlines.length} açık süre ve ${openTasks.length} açık görev bulunuyor. ` +
        "Önce bunları tamamlayın veya iptal edin.",
      openDeadlines,
      openTasks,
    });
  }
}
