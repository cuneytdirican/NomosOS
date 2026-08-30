import { Injectable } from "@nestjs/common";
import type { CaseStatus as DbCaseStatus, DeadlineStatus as DbDeadlineStatus, Prisma, TaskStatus as DbTaskStatus } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/types";
import { addDays, endOfWeek, startOfDay, startOfWeek } from "../common/dates";

const OPEN_TASK_STATUSES: DbTaskStatus[] = ["ACIK", "DEVAM_EDIYOR", "KONTROLDE", "ONAY_BEKLIYOR"];
const OPEN_DEADLINE_STATUSES: DbDeadlineStatus[] = ["BEKLIYOR", "ONAYLANDI"];
const ACTIVE_CASE_STATUSES: DbCaseStatus[] = [
  "ACIK",
  "DERDEST",
  "KARAR",
  "ISTINAF",
  "TEMYIZ",
  "KESINLESTI",
  "ICRADA",
];

/** Kritik süre eşiği (Modül 18 — kural 3): 3 gün veya daha az kalan. */
const CRITICAL_DAYS = 3;

const CASE_BRIEF = {
  id: true,
  title: true,
  fileNumber: true,
  courtName: true,
  client: { select: { id: true, name: true } },
  responsibleUser: { select: { id: true, fullName: true } },
} satisfies Prisma.CaseSelect;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /dashboard/summary — panelin tüm verisi tek çağrıda.
   * scope=me verilirse yalnız kullanıcının sorumlu olduğu dosyalar/görevler sayılır.
   */
  async summary(user: AuthUser, scope?: string) {
    const tenantId = user.tenantId;
    const mine = scope === "me";
    const now = new Date();
    const today = startOfDay(now);
    const weekStart = startOfWeek(now);
    const weekEnd = endOfWeek(now);
    const criticalUntil = addDays(today, CRITICAL_DAYS + 1);

    const caseScope: Prisma.CaseWhereInput = mine ? { responsibleUserId: user.userId } : {};
    const relatedCase: Prisma.CaseWhereInput | undefined = mine ? { responsibleUserId: user.userId } : undefined;

    const hearingWhere: Prisma.HearingWhereInput = {
      tenantId,
      status: "PLANLANDI",
      date: { gte: weekStart, lte: weekEnd },
      ...(relatedCase ? { case: relatedCase } : {}),
    };
    const criticalDeadlineWhere: Prisma.DeadlineWhereInput = {
      tenantId,
      status: { in: OPEN_DEADLINE_STATUSES },
      // ALT SINIR ZORUNLU: `lt` tek başına, vadesi aylar önce geçmiş açık
      // süreleri de "3 gün veya daha az kalan" sayacına dâhil ediyordu; aynı
      // kayıtlar riskyDeadlines içinde ikinci kez sayılıp panelde "kritik"
      // rakamını şişiriyordu (denetim bulgusu 15).
      dueDate: { gte: today, lt: criticalUntil },
      ...(relatedCase ? { case: relatedCase } : {}),
    };
    const riskyDeadlineWhere: Prisma.DeadlineWhereInput = {
      tenantId,
      OR: [
        { status: { in: OPEN_DEADLINE_STATUSES }, dueDate: { lt: today } },
        { status: "KACIRILDI" },
      ],
      ...(relatedCase ? { case: relatedCase } : {}),
    };
    const openTaskWhere: Prisma.TaskWhereInput = {
      tenantId,
      status: { in: OPEN_TASK_STATUSES },
      ...(mine ? { OR: [{ assigneeId: user.userId }, { reviewerId: user.userId }] } : {}),
    };
    const activeCaseWhere: Prisma.CaseWhereInput = {
      tenantId,
      status: { in: ACTIVE_CASE_STATUSES },
      ...caseScope,
    };
    const myTaskWhere: Prisma.TaskWhereInput = {
      tenantId,
      assigneeId: user.userId,
      status: { in: OPEN_TASK_STATUSES },
    };

    const [
      hearingsThisWeekCount,
      hearingsThisWeekItems,
      criticalDeadlinesCount,
      criticalDeadlineItems,
      openTasksCount,
      openTasksByStatus,
      activeCasesCount,
      totalCasesCount,
      clientCount,
      myTasksCount,
      myTaskItems,
      myOverdueTasksCount,
      riskyDeadlinesCount,
      riskyDeadlineItems,
    ] = await Promise.all([
      this.prisma.client.hearing.count({ where: hearingWhere }),
      this.prisma.client.hearing.findMany({
        where: hearingWhere,
        orderBy: { date: "asc" },
        take: 20,
        include: { case: { select: CASE_BRIEF } },
      }),
      this.prisma.client.deadline.count({ where: criticalDeadlineWhere }),
      this.prisma.client.deadline.findMany({
        where: criticalDeadlineWhere,
        orderBy: { dueDate: "asc" },
        take: 20,
        include: { owner: { select: { id: true, fullName: true } }, case: { select: CASE_BRIEF } },
      }),
      this.prisma.client.task.count({ where: openTaskWhere }),
      this.prisma.client.task.groupBy({
        by: ["status"],
        where: openTaskWhere,
        orderBy: { status: "asc" },
        _count: { _all: true },
      }),
      this.prisma.client.case.count({ where: activeCaseWhere }),
      this.prisma.client.case.count({ where: { tenantId, ...caseScope } }),
      this.prisma.client.client.count({ where: { tenantId, isActive: true } }),
      this.prisma.client.task.count({ where: myTaskWhere }),
      this.prisma.client.task.findMany({
        where: myTaskWhere,
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
        take: 10,
        include: { case: { select: { id: true, title: true, fileNumber: true } } },
      }),
      this.prisma.client.task.count({ where: { ...myTaskWhere, dueDate: { lt: today } } }),
      this.prisma.client.deadline.count({ where: riskyDeadlineWhere }),
      this.prisma.client.deadline.findMany({
        where: riskyDeadlineWhere,
        orderBy: { dueDate: "asc" },
        take: 20,
        include: { owner: { select: { id: true, fullName: true } }, case: { select: CASE_BRIEF } },
      }),
    ]);

    return {
      scope: mine ? "me" : "office",
      generatedAt: now,
      period: { weekStart, weekEnd, criticalDays: CRITICAL_DAYS },
      hearingsThisWeek: { count: hearingsThisWeekCount, items: hearingsThisWeekItems },
      criticalDeadlines: { count: criticalDeadlinesCount, items: criticalDeadlineItems },
      openTasks: {
        count: openTasksCount,
        byStatus: openTasksByStatus.map((row) => ({ status: row.status, count: row._count._all })),
      },
      activeCases: { count: activeCasesCount, total: totalCasesCount },
      clientCount,
      myTasks: { count: myTasksCount, overdue: myOverdueTasksCount, items: myTaskItems },
      riskyDeadlines: { count: riskyDeadlinesCount, items: riskyDeadlineItems },
    };
  }
}
