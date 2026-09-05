import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  supportDueAt,
  supportSla,
  type SupportPriority,
} from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { hasRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";

/**
 * FAZ 8C — destek talepleri (kiracı tarafı).
 *  - Her büro kullanıcısı talep açar ve kendi bürosunun taleplerini görür (kiracı izolasyonu).
 *  - Platform iç notları (`internal=true`) kiracıya DÖNMEZ.
 *  - Kapatma: talebi açan ya da ONAY rolü (ADMIN/PARTNER).
 *  - SLA ilk yanıt süresi önceliğe göre açılışta sabitlenir (`firstResponseDueAt`).
 */

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(10_000),
  category: z.enum(SUPPORT_CATEGORIES).default("GENEL"),
  priority: z.enum(SUPPORT_PRIORITIES).default("NORMAL"),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const ticketMessageSchema = z.object({ body: z.string().trim().min(1).max(10_000) });
export type TicketMessageInput = z.infer<typeof ticketMessageSchema>;

const PUBLIC_MESSAGE_SELECT = { id: true, authorKind: true, authorName: true, body: true, createdAt: true } as const;

@Injectable()
export class SupportTicketsService {
  constructor(private readonly prisma: PrismaService) {}

  private async authorName(userId: string): Promise<string> {
    const u = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    return u?.fullName ?? "Büro kullanıcısı";
  }

  async list(user: AuthUser, status?: string) {
    const rows = await this.prisma.client.supportTicket.findMany({
      where: { tenantId: user.tenantId, ...(status ? { status } : {}) },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
    });
    return {
      items: rows.map((t) => ({ ...t, sla: supportSla(t) })),
      acik: rows.filter((t) => t.status !== "KAPALI" && t.status !== "COZULDU").length,
    };
  }

  async create(user: AuthUser, input: CreateTicketInput) {
    const now = new Date();
    const name = await this.authorName(user.userId);
    const ticket = await this.prisma.client.supportTicket.create({
      data: {
        tenantId: user.tenantId,
        createdByUserId: user.userId,
        subject: input.subject,
        category: input.category,
        priority: input.priority,
        firstResponseDueAt: supportDueAt(input.priority as SupportPriority, now),
        lastMessageAt: now,
        messages: { create: { authorKind: "KIRACI", authorId: user.userId, authorName: name, body: input.body } },
      },
    });
    return { ...ticket, sla: supportSla(ticket, now) };
  }

  private async ownTicket(user: AuthUser, id: string) {
    const t = await this.prisma.client.supportTicket.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!t) throw new NotFoundException("Destek talebi bulunamadı.");
    return t;
  }

  async detail(user: AuthUser, id: string) {
    const t = await this.ownTicket(user, id);
    const messages = await this.prisma.client.supportTicketMessage.findMany({
      where: { ticketId: id, internal: false },
      orderBy: { createdAt: "asc" },
      select: PUBLIC_MESSAGE_SELECT,
    });
    return { ...t, sla: supportSla(t), messages };
  }

  async addMessage(user: AuthUser, id: string, input: TicketMessageInput) {
    const t = await this.ownTicket(user, id);
    if (t.status === "KAPALI") throw new BadRequestException("Kapalı talebe mesaj eklenemez; yeni talep açın.");
    const name = await this.authorName(user.userId);
    const now = new Date();
    await this.prisma.client.supportTicketMessage.create({
      data: { ticketId: id, authorKind: "KIRACI", authorId: user.userId, authorName: name, body: input.body },
    });
    // Büro yanıt verdi → platform sırası (çözüldü işaretliyse yeniden açılır).
    await this.prisma.client.supportTicket.update({ where: { id }, data: { status: "ACIK", lastMessageAt: now, resolvedAt: null } });
    return this.detail(user, id);
  }

  async close(user: AuthUser, id: string) {
    const t = await this.ownTicket(user, id);
    if (t.createdByUserId !== user.userId && !hasRole(user, ROLE_SETS.ONAY)) {
      throw new ForbiddenException("Talebi yalnız açan kullanıcı ya da büro yöneticisi kapatabilir.");
    }
    const now = new Date();
    await this.prisma.client.supportTicket.update({ where: { id }, data: { status: "KAPALI", closedAt: now, resolvedAt: t.resolvedAt ?? now } });
    return this.detail(user, id);
  }
}
