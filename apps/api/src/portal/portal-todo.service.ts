/**
 * FAZ 7F — müvekkil "yapılacaklar" (PortalTodo).
 *
 * Büro müvekkilden bir şey ister (belge, imza, bilgi); müvekkil portalda tamamlar ve not düşer.
 * Görünürlük: yalnız kendi müvekkil kaydı; dosyaya bağlıysa dosyanın portalda YAYINDA olması
 * şarttır (aksi hâlde yayınlanmamış dosyanın varlığı sızardı).
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PortalPublicationService } from "./portal-publication.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import type { PortalAuthUser } from "./portal.types";

export const createPortalTodoSchema = z.object({
  clientId: z.string().uuid(),
  caseId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});
export type CreatePortalTodoInput = z.infer<typeof createPortalTodoSchema>;

export const completePortalTodoSchema = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
});
export type CompletePortalTodoInput = z.infer<typeof completePortalTodoSchema>;

function dto(t: { id: string; caseId: string | null; title: string; description: string | null; dueDate: Date | null; status: string; completedAt: Date | null; completedNote: string | null; createdAt: Date; case?: { title: string; fileNumber: string | null } | null }) {
  return {
    id: t.id,
    caseId: t.caseId,
    caseTitle: t.case?.title ?? null,
    caseFileNumber: t.case?.fileNumber ?? null,
    title: t.title,
    description: t.description,
    dueDate: t.dueDate,
    status: t.status,
    completedAt: t.completedAt,
    completedNote: t.completedNote,
    createdAt: t.createdAt,
  };
}

@Injectable()
export class PortalTodoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly publications: PortalPublicationService,
  ) {}

  /* ------------------------- büro (portal-admin) ------------------------- */

  async listForOffice(user: AuthUser, clientId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "müvekkil yapılacaklarını görüntüleme");
    const rows = await this.prisma.client.portalTodo.findMany({
      where: { tenantId: user.tenantId, clientId },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      include: { case: { select: { title: true, fileNumber: true } } },
      take: 200,
    });
    return { items: rows.map(dto) };
  }

  async create(user: AuthUser, input: CreatePortalTodoInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "müvekkile yapılacak atama");
    const client = await this.prisma.client.client.findFirst({ where: { id: input.clientId, tenantId: user.tenantId }, select: { id: true } });
    if (!client) throw new NotFoundException("Müvekkil bulunamadı.");
    if (input.caseId) {
      const c = await this.prisma.client.case.findFirst({ where: { id: input.caseId, tenantId: user.tenantId, clientId: input.clientId }, select: { id: true } });
      if (!c) throw new NotFoundException("Dosya bulunamadı ya da bu müvekkile ait değil.");
    }
    const row = await this.prisma.client.portalTodo.create({
      data: { tenantId: user.tenantId, clientId: input.clientId, caseId: input.caseId ?? null, title: input.title, description: input.description ?? null, dueDate: input.dueDate ?? null, createdBy: user.userId },
      include: { case: { select: { title: true, fileNumber: true } } },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "PORTAL_TODO_CREATE", entity: "PortalTodo", entityId: row.id, detail: `${row.title} → müvekkil ${input.clientId}` });
    return dto(row);
  }

  async cancel(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.OPERASYON, "müvekkil yapılacağını iptal");
    const row = await this.prisma.client.portalTodo.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException("Kayıt bulunamadı.");
    const updated = await this.prisma.client.portalTodo.update({ where: { id: row.id }, data: { status: "IPTAL" }, include: { case: { select: { title: true, fileNumber: true } } } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "PORTAL_TODO_CANCEL", entity: "PortalTodo", entityId: row.id, detail: row.title });
    return dto(updated);
  }

  /* ------------------------- müvekkil (portal) ------------------------- */

  async listForClient(user: PortalAuthUser) {
    const visibleCases = new Set(await this.publications.visibleCaseIds(user));
    const rows = await this.prisma.client.portalTodo.findMany({
      where: { tenantId: user.tenantId, clientId: user.clientId, status: { not: "IPTAL" } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      include: { case: { select: { title: true, fileNumber: true } } },
      take: 200,
    });
    // Yayınlanmamış dosyaya bağlı istek gizlenir (dosya varlığı sızmasın).
    return { items: rows.filter((r) => !r.caseId || visibleCases.has(r.caseId)).map(dto) };
  }

  async complete(user: PortalAuthUser, id: string, input: CompletePortalTodoInput) {
    const row = await this.prisma.client.portalTodo.findFirst({ where: { id, tenantId: user.tenantId, clientId: user.clientId } });
    if (!row) throw new NotFoundException("Kayıt bulunamadı.");
    if (row.status !== "ACIK") throw new BadRequestException("Bu istek zaten kapanmış.");
    const updated = await this.prisma.client.portalTodo.update({
      where: { id: row.id },
      data: { status: "TAMAMLANDI", completedAt: new Date(), completedNote: input.note ?? null, completedByPortalUserId: user.portalUserId },
      include: { case: { select: { title: true, fileNumber: true } } },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: row.createdBy, action: "PORTAL_TODO_COMPLETED", entity: "PortalTodo", entityId: row.id, detail: `müvekkil ${user.fullName} tamamladı: ${row.title}${input.note ? ` — ${input.note.slice(0, 200)}` : ""}` });
    return dto(updated);
  }
}
