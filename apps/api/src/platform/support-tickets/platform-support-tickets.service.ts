import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { SUPPORT_PRIORITIES, SUPPORT_STATUSES, supportDueAt, supportSla, type SupportPriority } from "@nomosos/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import type { PlatformAuthUser } from "../platform.types";

/**
 * FAZ 8C — destek talepleri (platform tarafı): kuyruk, SLA sayacı, yanıt, iç not, durum/öncelik/atama.
 * İlk kamuya açık platform yanıtı `firstResponseAt`'ı doldurur (SLA ölçümü); iç not SLA'yı durdurmaz.
 */

export const platformTicketReplySchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  internal: z.boolean().default(false),
});
export type PlatformTicketReplyInput = z.infer<typeof platformTicketReplySchema>;

export const platformTicketUpdateSchema = z
  .object({
    status: z.enum(SUPPORT_STATUSES).optional(),
    priority: z.enum(SUPPORT_PRIORITIES).optional(),
    /** null → atamayı kaldır; "me" → istek sahibi. */
    assignedPlatformUserId: z.string().max(80).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined || v.assignedPlatformUserId !== undefined, "En az bir alan gerekir.");
export type PlatformTicketUpdateInput = z.infer<typeof platformTicketUpdateSchema>;

@Injectable()
export class PlatformSupportTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService
  ) {}

  async list(query: { status?: string; tenantId?: string }) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
    };
    const rows = await this.prisma.client.supportTicket.findMany({ where, orderBy: [{ status: "asc" }, { firstResponseDueAt: "asc" }], take: 300 });
    const tenants = await this.prisma.client.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } });
    const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
    const items = rows.map((t) => ({ ...t, tenantName: tenantName.get(t.tenantId) ?? t.tenantId, sla: supportSla(t) }));
    const openStates = new Set(["ACIK", "YANITLANDI", "MUSTERI_BEKLENIYOR"]);
    return {
      items,
      acik: items.filter((t) => openStates.has(t.status)).length,
      slaIhlal: items.filter((t) => t.sla.state === "IHLAL").length,
      yanitBekleyen: items.filter((t) => t.status === "ACIK").length,
    };
  }

  async detail(id: string) {
    const t = await this.prisma.client.supportTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Destek talebi bulunamadı.");
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: t.tenantId }, select: { name: true } });
    const messages = await this.prisma.client.supportTicketMessage.findMany({ where: { ticketId: id }, orderBy: { createdAt: "asc" } });
    return { ...t, tenantName: tenant?.name ?? t.tenantId, sla: supportSla(t), messages };
  }

  async reply(user: PlatformAuthUser, id: string, input: PlatformTicketReplyInput) {
    const t = await this.prisma.client.supportTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Destek talebi bulunamadı.");
    const now = new Date();
    await this.prisma.client.supportTicketMessage.create({
      data: { ticketId: id, authorKind: "PLATFORM", authorId: user.id, authorName: user.fullName || user.email, body: input.body, internal: input.internal },
    });
    if (!input.internal) {
      await this.prisma.client.supportTicket.update({
        where: { id },
        data: {
          lastMessageAt: now,
          firstResponseAt: t.firstResponseAt ?? now,
          status: t.status === "ACIK" ? "YANITLANDI" : t.status,
          assignedPlatformUserId: t.assignedPlatformUserId ?? user.id,
        },
      });
    }
    await this.audit.log({ actor: user, action: input.internal ? "SUPPORT_TICKET_NOTE" : "SUPPORT_TICKET_REPLY", entity: "SupportTicket", entityId: id, detail: `tenant=${t.tenantId}` });
    return this.detail(id);
  }

  async update(user: PlatformAuthUser, id: string, input: PlatformTicketUpdateInput) {
    const t = await this.prisma.client.supportTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Destek talebi bulunamadı.");
    const now = new Date();
    const data: Record<string, unknown> = {};
    if (input.status && input.status !== t.status) {
      data.status = input.status;
      if (input.status === "COZULDU") data.resolvedAt = now;
      if (input.status === "KAPALI") {
        data.closedAt = now;
        data.resolvedAt = t.resolvedAt ?? now;
      }
    }
    if (input.priority && input.priority !== t.priority) {
      data.priority = input.priority;
      // Öncelik değişince SLA hedefi açılış anına göre yeniden hesaplanır (yanıt verilmediyse).
      if (!t.firstResponseAt) data.firstResponseDueAt = supportDueAt(input.priority as SupportPriority, t.createdAt);
    }
    if (input.assignedPlatformUserId !== undefined) {
      data.assignedPlatformUserId = input.assignedPlatformUserId === "me" ? user.id : input.assignedPlatformUserId;
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.client.supportTicket.update({ where: { id }, data });
      await this.audit.log({ actor: user, action: "SUPPORT_TICKET_UPDATE", entity: "SupportTicket", entityId: id, detail: JSON.stringify(data) });
    }
    return this.detail(id);
  }
}
