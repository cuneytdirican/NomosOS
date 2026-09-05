/**
 * KRONOMETRE (Faz 6) — kullanıcı başına tek çalışan sayaç; durdurulunca TimeEntry (TASLAK).
 *   POST /billing/time-entries/timer/start {caseId?, clientId?, description}
 *   GET  /billing/time-entries/timer            → çalışan sayaç (geçen dakika)
 *   POST /billing/time-entries/timer/stop {description?} → TimeEntry (en az 1 dk, yukarı yuvarlar)
 *   DELETE /billing/time-entries/timer          → iptal (kayıt üretmez)
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { FINANCE_ACCESS, assertFinanceAccess } from "../finance/finance-access";
import type { AuthUser } from "../common/types";

export const timerStartSchema = z.object({
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(3).max(500),
});
export const timerStopSchema = z.object({
  description: z.string().trim().min(3).max(500).optional(),
  billable: z.boolean().optional(),
});
export type TimerStartInput = z.infer<typeof timerStartSchema>;
export type TimerStopInput = z.infer<typeof timerStopSchema>;

export function elapsedMinutes(startedAt: Date, now = new Date()): number {
  return Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60_000));
}

@Injectable()
export class TimeTimerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async current(user: AuthUser) {
    const t = await this.prisma.client.timeTimer.findUnique({ where: { userId: user.userId } });
    if (!t || t.tenantId !== user.tenantId) return { calisiyor: false as const };
    return { calisiyor: true as const, id: t.id, caseId: t.caseId, clientId: t.clientId, description: t.description, startedAt: t.startedAt, gecenDakika: elapsedMinutes(t.startedAt) };
  }

  async start(user: AuthUser, input: TimerStartInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.TIME_WRITE, "kronometre başlatma");
    const existing = await this.prisma.client.timeTimer.findUnique({ where: { userId: user.userId } });
    if (existing) throw new BadRequestException("Zaten çalışan bir kronometre var; önce durdurun ya da iptal edin.");
    if (input.caseId) {
      const c = await this.prisma.client.case.findFirst({ where: { id: input.caseId, tenantId: user.tenantId }, select: { id: true, clientId: true } });
      if (!c) throw new NotFoundException("Dosya bulunamadı.");
      input = { ...input, clientId: input.clientId ?? c.clientId };
    }
    const t = await this.prisma.client.timeTimer.create({
      data: { tenantId: user.tenantId, userId: user.userId, caseId: input.caseId ?? null, clientId: input.clientId ?? null, description: input.description },
    });
    return this.current(user).then((c) => ({ ...c, id: t.id }));
  }

  async stop(user: AuthUser, input: TimerStopInput) {
    const t = await this.prisma.client.timeTimer.findUnique({ where: { userId: user.userId } });
    if (!t || t.tenantId !== user.tenantId) throw new NotFoundException("Çalışan kronometre yok.");
    const minutes = elapsedMinutes(t.startedAt);
    const entry = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.timeEntry.create({
        data: {
          tenantId: user.tenantId,
          userId: user.userId,
          caseId: t.caseId,
          clientId: t.clientId,
          date: t.startedAt,
          minutes,
          description: input.description ?? t.description,
          billable: input.billable ?? true,
          status: "TASLAK",
        },
      });
      await tx.timeTimer.delete({ where: { id: t.id } });
      return created;
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "TIME_ENTRY_CREATE", entity: "TimeEntry", entityId: entry.id, detail: `Kronometre: ${minutes} dk — ${entry.description.slice(0, 80)}` });
    return { id: entry.id, minutes, status: entry.status, description: entry.description, date: entry.date, mesaj: `${minutes} dakikalık zaman kaydı TASLAK olarak oluşturuldu; onaya gönderip faturalayabilirsiniz.` };
  }

  async cancel(user: AuthUser) {
    const t = await this.prisma.client.timeTimer.findUnique({ where: { userId: user.userId } });
    if (t && t.tenantId === user.tenantId) await this.prisma.client.timeTimer.delete({ where: { id: t.id } });
    return { ok: true };
  }
}
