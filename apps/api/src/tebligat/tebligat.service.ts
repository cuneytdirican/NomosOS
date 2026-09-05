/**
 * TEBLİGAT (Faz 6) — dosya bazlı tebligat kayıtları; tebliğ tarihi + kural anahtarı ile süre
 * motoru süreyi OTOMATİK açar (DeadlinesService.createFromRule; kaynak KURAL, tebligat yöntemi
 * kanaldan türetilir: UETS/KEP → ELEKTRONIK, PTT → POSTA, elden → ELDEN).
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Tebligat, TebligatKanali } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DeadlinesService } from "../deadlines/deadlines.service";
import { ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";
import { TebligatSaglayiciRegistry } from "./tebligat-saglayici";

export const TEBLIGAT_KANALLARI = ["UETS", "KEP", "PTT", "ELDEN", "EPOSTA", "DIGER"] as const;
export const TEBLIGAT_KANAL_LABELS: Record<TebligatKanali, string> = {
  UETS: "UETS (elektronik tebligat)",
  KEP: "KEP",
  PTT: "PTT / posta",
  ELDEN: "Elden / memur eliyle",
  EPOSTA: "E-posta (bilgilendirme)",
  DIGER: "Diğer",
};

export const createTebligatSchema = z.object({
  channel: z.enum(TEBLIGAT_KANALLARI),
  direction: z.enum(["GELEN", "GIDEN"]).default("GELEN"),
  subject: z.string().trim().min(3).max(300),
  counterparty: z.string().trim().max(300).nullable().optional(),
  documentId: z.string().uuid().nullable().optional(),
  sentAt: z.coerce.date().nullable().optional(),
  servedAt: z.coerce.date().nullable().optional(),
  externalRef: z.string().trim().max(200).nullable().optional(),
  /** Tebliğ tarihiyle açılacak süre kuralı (örn. HMK_ISTINAF, IIK_ODEME_EMRI_ITIRAZ). */
  deadlineRuleKey: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type CreateTebligatInput = z.infer<typeof createTebligatSchema>;
export const updateTebligatSchema = createTebligatSchema.partial();
export type UpdateTebligatInput = z.infer<typeof updateTebligatSchema>;

/** Kanal → süre motoru tebligat yöntemi (HMK/İİK kaydırma kuralları). */
export function serviceMethodFor(channel: TebligatKanali): "ETEBLIGAT" | "POSTA" | "ELDEN" {
  if (channel === "UETS" || channel === "KEP" || channel === "EPOSTA") return "ETEBLIGAT";
  if (channel === "PTT") return "POSTA";
  return "ELDEN";
}

@Injectable()
export class TebligatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly deadlines: DeadlinesService,
    private readonly registry: TebligatSaglayiciRegistry,
  ) {}

  async list(user: AuthUser, caseId: string) {
    await this.requireCase(user.tenantId, caseId);
    const rows = await this.prisma.client.tebligat.findMany({ where: { tenantId: user.tenantId, caseId }, orderBy: [{ servedAt: "desc" }, { createdAt: "desc" }] });
    return { items: rows.map(dto), saglayici: this.registry.describe() };
  }

  async create(user: AuthUser, caseId: string, input: CreateTebligatInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "tebligat kaydı");
    await this.requireCase(user.tenantId, caseId);
    const row = await this.prisma.client.tebligat.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        documentId: input.documentId ?? null,
        channel: input.channel,
        direction: input.direction,
        subject: input.subject,
        counterparty: input.counterparty ?? null,
        sentAt: input.sentAt ?? null,
        servedAt: input.servedAt ?? null,
        externalRef: input.externalRef ?? null,
        deadlineRuleKey: input.deadlineRuleKey ?? null,
        note: input.note ?? null,
        createdBy: user.userId,
      },
    });
    const withDeadline = await this.maybeOpenDeadline(user, row);
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "TEBLIGAT_CREATE", entity: "Tebligat", entityId: row.id, detail: `${row.channel} ${row.direction} — ${row.subject}${row.servedAt ? ` (tebliğ ${row.servedAt.toISOString().slice(0, 10)})` : ""}` });
    return dto(withDeadline);
  }

  async update(user: AuthUser, id: string, input: UpdateTebligatInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "tebligat güncelleme");
    const existing = await this.prisma.client.tebligat.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw new NotFoundException("Tebligat kaydı bulunamadı.");
    const row = await this.prisma.client.tebligat.update({
      where: { id },
      data: {
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.direction !== undefined ? { direction: input.direction } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.counterparty !== undefined ? { counterparty: input.counterparty } : {}),
        ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
        ...(input.sentAt !== undefined ? { sentAt: input.sentAt } : {}),
        ...(input.servedAt !== undefined ? { servedAt: input.servedAt } : {}),
        ...(input.externalRef !== undefined ? { externalRef: input.externalRef } : {}),
        ...(input.deadlineRuleKey !== undefined ? { deadlineRuleKey: input.deadlineRuleKey } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    const withDeadline = await this.maybeOpenDeadline(user, row);
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "TEBLIGAT_UPDATE", entity: "Tebligat", entityId: id, detail: JSON.stringify(input).slice(0, 300) });
    return dto(withDeadline);
  }

  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "tebligat silme");
    const existing = await this.prisma.client.tebligat.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw new NotFoundException("Tebligat kaydı bulunamadı.");
    await this.prisma.client.tebligat.delete({ where: { id } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "TEBLIGAT_DELETE", entity: "Tebligat", entityId: id, detail: existing.subject });
    return { ok: true };
  }

  saglayici() {
    return this.registry.describe();
  }

  /** Tebliğ tarihi + kural varsa ve süre henüz açılmadıysa: kural motorundan süre (ONAYLI). */
  private async maybeOpenDeadline(user: AuthUser, row: Tebligat): Promise<Tebligat> {
    if (!row.servedAt || !row.deadlineRuleKey || row.deadlineId) return row;
    try {
      const deadline = await this.deadlines.createFromRule(user, {
        caseId: row.caseId,
        ruleKey: row.deadlineRuleKey,
        triggerDate: row.servedAt,
        serviceMethod: serviceMethodFor(row.channel),
        title: undefined,
        ownerId: null,
      });
      return this.prisma.client.tebligat.update({ where: { id: row.id }, data: { deadlineId: deadline.deadline.id } });
    } catch (err) {
      throw new BadRequestException(`Tebligat kaydedildi ancak süre açılamadı: ${(err as Error).message}`);
    }
  }

  private async requireCase(tenantId: string, caseId: string) {
    const c = await this.prisma.client.case.findFirst({ where: { id: caseId, tenantId }, select: { id: true } });
    if (!c) throw new NotFoundException("Dosya bulunamadı.");
    return c;
  }
}

export function dto(t: Tebligat) {
  return {
    id: t.id,
    caseId: t.caseId,
    documentId: t.documentId,
    channel: t.channel,
    channelLabel: TEBLIGAT_KANAL_LABELS[t.channel],
    direction: t.direction,
    subject: t.subject,
    counterparty: t.counterparty,
    sentAt: t.sentAt,
    servedAt: t.servedAt,
    externalRef: t.externalRef,
    deadlineRuleKey: t.deadlineRuleKey,
    deadlineId: t.deadlineId,
    note: t.note,
    createdAt: t.createdAt,
  };
}
