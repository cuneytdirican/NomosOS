/**
 * FAZ 7C — iş akışı şablonları: listele / büro şablonu yaz / dosyaya uygula.
 *
 * Uygulama: tek transaction'da görevler + durum günlükleri; `workflowKey` ile zincir
 * izlenir. Atama tahmin edilmez: verilen kullanıcı → dosya sorumlusu → uygulayan.
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import { touchCase } from "../common/case-denormals";
import type { AuthUser } from "../common/types";
import { SYSTEM_WORKFLOW_TEMPLATES, workflowItemSchema, type ApplyWorkflowInput, type WorkflowItem, type WorkflowTemplateInput } from "./workflow-templates";

export interface WorkflowTemplateView {
  id: string | null;
  key: string;
  name: string;
  caseType: string | null;
  description: string | null;
  items: WorkflowItem[];
  isSystem: boolean;
  isActive: boolean;
}

export function parseItems(json: string): WorkflowItem[] {
  try {
    const raw = JSON.parse(json) as unknown[];
    return raw.map((r) => workflowItemSchema.parse(r));
  } catch {
    return [];
  }
}

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, caseType?: string): Promise<WorkflowTemplateView[]> {
    const rows = await this.prisma.client.workflowTemplate.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: "asc" } });
    const tenant: WorkflowTemplateView[] = rows.map((r) => ({ id: r.id, key: r.key, name: r.name, caseType: r.caseType, description: r.description, items: parseItems(r.itemsJson), isSystem: false, isActive: r.isActive }));
    const overridden = new Set(rows.map((r) => r.key));
    const system: WorkflowTemplateView[] = SYSTEM_WORKFLOW_TEMPLATES.filter((t) => !overridden.has(t.key)).map((t) => ({ id: null, key: t.key, name: t.name, caseType: t.caseType, description: t.description, items: t.items, isSystem: true, isActive: true }));
    const all = [...tenant, ...system];
    return caseType ? all.filter((t) => !t.caseType || t.caseType === caseType) : all;
  }

  async resolve(user: AuthUser, key: string): Promise<WorkflowTemplateView> {
    const found = (await this.list(user)).find((t) => t.key === key);
    if (!found) throw new NotFoundException("İş akışı şablonu bulunamadı.");
    if (!found.isActive) throw new BadRequestException("Bu şablon pasif.");
    return found;
  }

  async create(user: AuthUser, input: WorkflowTemplateInput) {
    assertRole(user, ROLE_SETS.ONAY, "iş akışı şablonu yazma");
    const exists = await this.prisma.client.workflowTemplate.findUnique({ where: { tenantId_key: { tenantId: user.tenantId, key: input.key } } });
    if (exists) throw new BadRequestException("Bu anahtarla bir şablon zaten var.");
    const row = await this.prisma.client.workflowTemplate.create({
      data: { tenantId: user.tenantId, key: input.key, name: input.name, caseType: input.caseType ?? null, description: input.description ?? null, itemsJson: JSON.stringify(input.items), isActive: input.isActive, createdBy: user.userId },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "WORKFLOW_TEMPLATE_CREATE", entity: "WorkflowTemplate", entityId: row.id, detail: `${row.key} — ${input.items.length} adım` });
    return { id: row.id, key: row.key };
  }

  async update(user: AuthUser, id: string, input: Partial<WorkflowTemplateInput>) {
    assertRole(user, ROLE_SETS.ONAY, "iş akışı şablonu düzenleme");
    const row = await this.prisma.client.workflowTemplate.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException("Şablon bulunamadı.");
    const updated = await this.prisma.client.workflowTemplate.update({
      where: { id: row.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.caseType !== undefined ? { caseType: input.caseType ?? null } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.items !== undefined ? { itemsJson: JSON.stringify(input.items) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "WORKFLOW_TEMPLATE_UPDATE", entity: "WorkflowTemplate", entityId: row.id, detail: updated.key });
    return { id: updated.id, key: updated.key };
  }

  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "iş akışı şablonu silme");
    const row = await this.prisma.client.workflowTemplate.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException("Şablon bulunamadı.");
    await this.prisma.client.workflowTemplate.delete({ where: { id: row.id } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "WORKFLOW_TEMPLATE_DELETE", entity: "WorkflowTemplate", entityId: row.id, detail: row.key });
    return { ok: true };
  }

  /** Şablonu dosyaya uygula → görev zinciri. */
  async apply(user: AuthUser, key: string, input: ApplyWorkflowInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "iş akışı uygulama");
    const template = await this.resolve(user, key);
    const c = await this.prisma.client.case.findFirst({ where: { id: input.caseId, tenantId: user.tenantId }, select: { id: true, type: true, responsibleUserId: true, title: true } });
    if (!c) throw new NotFoundException("Dosya bulunamadı.");
    if (template.caseType && template.caseType !== c.type) {
      throw new BadRequestException(`Bu şablon ${template.caseType} türü içindir; dosya ${c.type} türünde.`);
    }
    const assigneeId = input.assigneeId ?? c.responsibleUserId ?? user.userId;
    const assignee = await this.prisma.client.user.findFirst({ where: { id: assigneeId, tenantId: user.tenantId, isActive: true }, select: { id: true } });
    if (!assignee) throw new NotFoundException("Atanacak kullanıcı bulunamadı.");
    if (input.reviewerId) {
      if (input.reviewerId === assigneeId) throw new BadRequestException("Sorumlu ile kontrol eden aynı kişi olamaz.");
      const r = await this.prisma.client.user.findFirst({ where: { id: input.reviewerId, tenantId: user.tenantId, isActive: true }, select: { id: true } });
      if (!r) throw new NotFoundException("Kontrol eden kullanıcı bulunamadı.");
    }
    const skip = new Set(input.skip ?? []);
    const start = input.startDate ?? new Date();
    const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const items = template.items.filter((_, i) => !skip.has(i));
    if (items.length === 0) throw new BadRequestException("Uygulanacak adım kalmadı.");

    const created = await this.prisma.client.$transaction(async (tx) => {
      const out: Array<{ id: string; title: string; dueDate: Date }> = [];
      for (const item of items) {
        const dueDate = new Date(startDay.getTime() + item.offsetDays * 86_400_000);
        const task = await tx.task.create({
          data: {
            tenantId: user.tenantId,
            caseId: c.id,
            title: item.title,
            description: [item.description, item.roleHint ? `Önerilen rol: ${item.roleHint}` : null].filter(Boolean).join("\n") || null,
            assigneeId,
            reviewerId: item.needsReview ? (input.reviewerId ?? null) : null,
            priority: item.priority,
            dueDate,
            workflowKey: template.key,
          },
          select: { id: true, title: true, dueDate: true },
        });
        await tx.taskStatusLog.create({ data: { taskId: task.id, fromStatus: null, toStatus: "ACIK", userId: user.userId, note: `İş akışı şablonundan oluşturuldu: ${template.name}` } });
        out.push({ id: task.id, title: task.title, dueDate: task.dueDate as Date });
      }
      return out;
    });
    await touchCase(this.prisma.client, c.id);
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "WORKFLOW_APPLY", entity: "Case", entityId: c.id, detail: `${template.key} → ${created.length} görev (${c.title.slice(0, 80)})` });
    return { ok: true, templateKey: template.key, templateName: template.name, caseId: c.id, tasks: created, count: created.length };
  }
}
