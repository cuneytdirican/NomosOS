import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, TaskStatus as DbTaskStatus } from "@nomosos/db";
import { TASK_PRIORITIES, TASK_STATUSES, type CreateTaskInput, type TaskStatus } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { relatedCaseVisibilityWhere } from "../common/case-visibility";
import type { AuthUser } from "../common/types";
import { assertRole, hasRole, ROLE_SETS } from "../common/roles";
import type { BulkTaskInput } from "./tasks-bulk";
import { parseDateParam, parseRangeEnd } from "../common/dates";
import { paged, resolvePage } from "../common/pagination";
import { touchCase } from "../common/case-denormals";
import {
  assertTaskStatusTransition,
  isApprovalTransition,
  isRejectionTransition,
  TASK_STATUS_TRANSITIONS,
} from "./task-status";
import type { UpdateTaskInput } from "./tasks.dto";

const OPEN_TASK_STATUSES: DbTaskStatus[] = ["ACIK", "DEVAM_EDIYOR", "KONTROLDE", "ONAY_BEKLIYOR"];

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list(
    tenantId: string,
    params: {
      status?: string;
      assigneeId?: string;
      reviewerId?: string;
      caseId?: string;
      priority?: string;
      overdue?: string;
      open?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    },
    viewer?: AuthUser
  ) {
    const where: Prisma.TaskWhereInput = { tenantId, ...(viewer ? relatedCaseVisibilityWhere(viewer, { optionalCase: true }) : {}) };
    const pageParams = resolvePage(params);

    if (params.status) {
      if (!(TASK_STATUSES as readonly string[]).includes(params.status)) {
        throw new BadRequestException("Geçersiz görev durumu.");
      }
      where.status = params.status as DbTaskStatus;
    } else if (params.open === "true") {
      where.status = { in: OPEN_TASK_STATUSES };
    }

    if (params.assigneeId) where.assigneeId = params.assigneeId;
    if (params.reviewerId) where.reviewerId = params.reviewerId;
    if (params.caseId) where.caseId = params.caseId;
    if (params.priority) {
      // Doğrulanmamış değer Prisma enum'una geçtiğinde PrismaClientValidationError
      // → ham 500 üretiyordu; `status` için yapılan kontrol burada eksikti
      // (denetim bulgusu 7). Aynı desen hearings/cases'te doğru uygulanmış.
      if (!(TASK_PRIORITIES as readonly string[]).includes(params.priority)) {
        throw new BadRequestException("Geçersiz öncelik.");
      }
      where.priority = params.priority as Prisma.TaskWhereInput["priority"];
    }

    const dueFilter: Prisma.DateTimeNullableFilter = {};
    if (params.from) dueFilter.gte = parseDateParam(params.from, "from");
    if (params.to) dueFilter.lte = parseRangeEnd(params.to, "to");
    if (params.overdue === "true") {
      dueFilter.lt = new Date();
      where.status = { in: OPEN_TASK_STATUSES };
    }
    if (Object.keys(dueFilter).length > 0) where.dueDate = dueFilter;

    const [items, total] = await Promise.all([
      this.prisma.client.task.findMany({
        where,
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        include: {
          assignee: { select: { id: true, fullName: true } },
          reviewer: { select: { id: true, fullName: true } },
          case: { select: { id: true, title: true, fileNumber: true } },
        },
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.task.count({ where }),
    ]);
    return paged(items, total, pageParams);
  }

  /** GET /tasks/:id — durum geçmişiyle birlikte. */
  async detail(tenantId: string, id: string) {
    const task = await this.prisma.client.task.findFirst({
      where: { id, tenantId },
      include: {
        assignee: { select: { id: true, fullName: true, role: true } },
        reviewer: { select: { id: true, fullName: true, role: true } },
        case: { select: { id: true, title: true, fileNumber: true, courtName: true, status: true } },
        statusLogs: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
    });
    if (!task) {
      throw new NotFoundException("Görev bulunamadı.");
    }
    return {
      ...task,
      allowedStatusTransitions: TASK_STATUS_TRANSITIONS[task.status as TaskStatus] ?? [],
    };
  }

  async create(user: AuthUser, input: CreateTaskInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "görev açma");
    await this.requireTenantUser(user.tenantId, input.assigneeId, "Atanan kullanıcı bulunamadı.");
    if (input.reviewerId) {
      await this.requireTenantUser(user.tenantId, input.reviewerId, "Kontrol eden kullanıcı bulunamadı.");
      if (input.reviewerId === input.assigneeId) {
        throw new BadRequestException("Sorumlu ile kontrol eden aynı kişi olamaz.");
      }
    }
    if (input.caseId) {
      await this.requireCase(user.tenantId, input.caseId);
    }

    const task = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.task.create({ data: { tenantId: user.tenantId, ...input } });
      await tx.taskStatusLog.create({
        data: { taskId: created.id, fromStatus: null, toStatus: created.status, userId: user.userId, note: "Görev oluşturuldu." },
      });
      return created;
    });

    if (input.caseId) {
      await touchCase(this.prisma.client, input.caseId);
    }
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "TASK_CREATE",
      entity: "Task",
      entityId: task.id,
      detail: task.title,
    });
    return task;
  }

  /** PATCH /tasks/:id — genel güncelleme (durum burada değişmez). */
  async update(user: AuthUser, id: string, input: UpdateTaskInput) {
    const existing = await this.requireTask(user.tenantId, id);
    const isLegal = hasRole(user, ROLE_SETS.HUKUKI);
    const isInvolved = existing.assigneeId === user.userId || existing.reviewerId === user.userId;
    const isSecretary = hasRole(user, ["SEKRETER"]);

    if (!isLegal && !isInvolved && !isSecretary) {
      throw new ForbiddenException("Bu görevi güncelleme yetkiniz yok.");
    }

    // SEKRETER, ilgisi olmayan görevlerde de düzenleme yapabiliyordu; bu,
    // "sekreter tarih/öncelik girebilsin" niyetinin fazla geniş yazılmış
    // hâliydi ve STAJYER'den daha geniş yetki doğuruyordu (denetim bulgusu 12).
    // Görevin KİME ait olduğunu ve hangi dosyaya bağlandığını değiştirmek
    // hukuki tasarruftur; sekretere yalnızca operasyonel alanlar bırakılır.
    if (isSecretary && !isLegal && !isInvolved) {
      const restricted = (["assigneeId", "reviewerId", "caseId"] as const).filter(
        (field) => input[field] !== undefined
      );
      if (restricted.length > 0) {
        throw new ForbiddenException(
          "Sekreter rolü görevin sorumlusunu, kontrol edenini veya bağlı dosyasını değiştiremez; " +
            "yalnızca son gün, öncelik ve açıklama alanlarını güncelleyebilir."
        );
      }
    }
    if (existing.status === "TAMAMLANDI" || existing.status === "IPTAL") {
      throw new BadRequestException(`«${existing.title}» görevi ${existing.status} durumunda olduğu için güncellenemez.`);
    }

    if (input.assigneeId) {
      await this.requireTenantUser(user.tenantId, input.assigneeId, "Atanan kullanıcı bulunamadı.");
    }
    if (input.reviewerId) {
      await this.requireTenantUser(user.tenantId, input.reviewerId, "Kontrol eden kullanıcı bulunamadı.");
    }
    const nextAssignee = input.assigneeId ?? existing.assigneeId;
    const nextReviewer = input.reviewerId === undefined ? existing.reviewerId : input.reviewerId;
    if (nextReviewer && nextReviewer === nextAssignee) {
      throw new BadRequestException("Sorumlu ile kontrol eden aynı kişi olamaz.");
    }
    if (input.caseId) {
      await this.requireCase(user.tenantId, input.caseId);
    }

    const updated = await this.prisma.client.task.update({
      where: { id },
      data: input as Prisma.TaskUncheckedUpdateInput,
      include: {
        assignee: { select: { id: true, fullName: true } },
        reviewer: { select: { id: true, fullName: true } },
        case: { select: { id: true, title: true, fileNumber: true } },
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "TASK_UPDATE",
      entity: "Task",
      entityId: id,
      detail: `${existing.title} — güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return updated;
  }

  /** PATCH /tasks/:id/status — durum makinesi + TaskStatusLog. */
  async updateStatus(user: AuthUser, id: string, status: TaskStatus, note?: string) {
    const existing = await this.requireTask(user.tenantId, id);
    const from = existing.status as TaskStatus;

    assertTaskStatusTransition(existing.title, from, status);

    if (isApprovalTransition(from, status)) {
      const isReviewer = existing.reviewerId === user.userId;
      if (!isReviewer && !hasRole(user, ROLE_SETS.ONAY)) {
        throw new ForbiddenException("Onay bekleyen görevi yalnızca kontrol eden kişi, ortak veya yönetici tamamlayabilir.");
      }
    }
    if (isRejectionTransition(from, status) && !note?.trim()) {
      throw new BadRequestException("Görevi geri gönderirken ret gerekçesi yazılmalıdır.");
    }
    if (from === "TAMAMLANDI" && !hasRole(user, ROLE_SETS.ONAY)) {
      throw new ForbiddenException("Tamamlanmış görevi yalnızca ortak veya yönetici yeniden açabilir.");
    }
    if (status === "IPTAL" && !hasRole(user, ROLE_SETS.HUKUKI)) {
      throw new ForbiddenException("Görev iptali için avukat, ortak veya yönetici yetkisi gerekir.");
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.task.update({
        where: { id },
        data: { status: status as DbTaskStatus },
      });
      await tx.taskStatusLog.create({
        data: {
          taskId: id,
          fromStatus: from as DbTaskStatus,
          toStatus: status as DbTaskStatus,
          userId: user.userId,
          note: note?.trim() ? note.trim() : undefined,
        },
      });
      if (existing.caseId) {
        await tx.timelineEvent.create({
          data: {
            tenantId: user.tenantId,
            caseId: existing.caseId,
            userId: user.userId,
            title: `Görev durumu: «${existing.title}» ${from} → ${status}`,
            detail: note?.trim() ? note.trim() : undefined,
            source: "SISTEM",
          },
        });
      }
      return result;
    });

    if (existing.caseId) {
      await touchCase(this.prisma.client, existing.caseId);
    }
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "TASK_STATUS_UPDATE",
      entity: "Task",
      entityId: id,
      detail: `${existing.title}: ${from} → ${status}${note ? ` (${note})` : ""}`,
    });
    return updated;
  }

  /** Faz 7C — kontrol/onay kuyruğu. */
  async reviewQueue(user: AuthUser) {
    const canApprove = hasRole(user, ROLE_SETS.ONAY);
    const rows = await this.prisma.client.task.findMany({
      where: {
        tenantId: user.tenantId,
        ...relatedCaseVisibilityWhere(user, { optionalCase: true }),
        OR: [
          { status: "KONTROLDE", reviewerId: user.userId },
          ...(canApprove ? [{ status: "ONAY_BEKLIYOR" as const }] : [{ status: "ONAY_BEKLIYOR" as const, reviewerId: user.userId }]),
        ],
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "asc" }],
      take: 100,
      include: { assignee: { select: { id: true, fullName: true } }, reviewer: { select: { id: true, fullName: true } }, case: { select: { id: true, title: true, fileNumber: true } } },
    });
    return { items: rows, total: rows.length, canApprove };
  }

  /** Faz 7C — iş yükü (kullanıcı bazlı açık görev / geciken / en yakın son tarih). */
  async workload(user: AuthUser) {
    assertRole(user, ROLE_SETS.HUKUKI, "iş yükü görünümü");
    const now = new Date();
    const rows = await this.prisma.client.task.findMany({
      where: { tenantId: user.tenantId, status: { notIn: ["TAMAMLANDI", "IPTAL"] }, ...relatedCaseVisibilityWhere(user, { optionalCase: true }) },
      select: { assigneeId: true, dueDate: true, priority: true, status: true, workflowKey: true, assignee: { select: { fullName: true } } },
    });
    const map = new Map<string, { userId: string; fullName: string; open: number; overdue: number; critical: number; inReview: number; nextDue: Date | null; workflows: number }>();
    for (const t of rows) {
      const cur = map.get(t.assigneeId) ?? { userId: t.assigneeId, fullName: t.assignee.fullName, open: 0, overdue: 0, critical: 0, inReview: 0, nextDue: null, workflows: 0 };
      cur.open += 1;
      if (t.dueDate && t.dueDate.getTime() < now.getTime()) cur.overdue += 1;
      if (t.priority === "KRITIK") cur.critical += 1;
      if (t.status === "KONTROLDE" || t.status === "ONAY_BEKLIYOR") cur.inReview += 1;
      if (t.workflowKey) cur.workflows += 1;
      if (t.dueDate && (!cur.nextDue || t.dueDate < cur.nextDue)) cur.nextDue = t.dueDate;
      map.set(t.assigneeId, cur);
    }
    const items = [...map.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
    return { items, totalOpen: rows.length, totalOverdue: items.reduce((a, i) => a + i.overdue, 0) };
  }

  /** Faz 7C — toplu işlem (döngü; her görev tek tek kapılardan geçer). */
  async bulk(user: AuthUser, input: BulkTaskInput) {
    const ok: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (const id of input.ids) {
      try {
        if (input.action === "STATUS") await this.updateStatus(user, id, input.status as TaskStatus, input.note);
        else if (input.action === "ASSIGN") await this.update(user, id, { assigneeId: input.assigneeId } as UpdateTaskInput);
        else if (input.action === "PRIORITY") await this.update(user, id, { priority: input.priority } as UpdateTaskInput);
        else await this.update(user, id, { dueDate: input.dueDate ?? null } as UpdateTaskInput);
        ok.push(id);
      } catch (err) {
        failed.push({ id, message: (err as Error).message.slice(0, 200) });
      }
    }
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "TASK_BULK", entity: "Task", entityId: ok[0] ?? input.ids[0], detail: `${input.action}: ${ok.length} başarılı, ${failed.length} başarısız` });
    return { ok: ok.length, okIds: ok, failed };
  }

  private async requireTask(tenantId: string, id: string) {
    const task = await this.prisma.client.task.findFirst({
      where: { id, tenantId },
      select: { id: true, title: true, status: true, assigneeId: true, reviewerId: true, caseId: true },
    });
    if (!task) {
      throw new NotFoundException("Görev bulunamadı.");
    }
    return task;
  }

  private async requireTenantUser(tenantId: string, userId: string, message: string) {
    const found = await this.prisma.client.user.findFirst({ where: { id: userId, tenantId }, select: { id: true } });
    if (!found) {
      throw new BadRequestException(message);
    }
    return found;
  }

  private async requireCase(tenantId: string, caseId: string) {
    const found = await this.prisma.client.case.findFirst({ where: { id: caseId, tenantId }, select: { id: true } });
    if (!found) {
      throw new BadRequestException("İlişkilendirilen dosya bulunamadı.");
    }
    return found;
  }
}
