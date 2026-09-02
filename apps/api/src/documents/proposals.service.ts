import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { DocumentActionProposal, Prisma, ProposalStatus, ProposalType, TaskPriority } from "@nomosos/db";
import { formatTrDate } from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
// D2 C3: AI eğitim verisi (opt-in kiracı) — karar anları örnek üretir.
import { AiTrainingDataService } from "../ai-training/ai-training.service";
import { DeadlineComputeService } from "../pipeline/deadline-compute.service";
import type { AuthUser } from "../common/types";
import { assertRole, ROLE_SETS } from "../common/roles";
import { paged, resolvePage } from "../common/pagination";
import { refreshCaseDenormals, touchCase } from "../common/case-denormals";
import type { ApproveProposalInput, RejectProposalInput } from "./documents.dto";

const PROPOSAL_TYPES: ProposalType[] = [
  "GOREV",
  "SURE",
  "SAFAHAT",
  "MUVEKKIL_BILGILENDIRME",
  "DOSYA_ESLESTIRME",
  "DURUSMA_GUNCELLEME",
];
const PROPOSAL_STATUSES: ProposalStatus[] = ["BEKLIYOR", "ONAYLANDI", "REDDEDILDI", "UYGULANDI"];

/** Hukuki tasarruf doğuran öneri tipleri — avukat/ortak/yönetici onayı ister. */
const LEGAL_DECISION_TYPES: ProposalType[] = ["SURE", "DURUSMA_GUNCELLEME", "MUVEKKIL_BILGILENDIRME"];

/**
 * ONAY KUYRUĞU.
 *
 * Belge hattının ürettiği HİÇBİR çıkarım kendiliğinden kayda dönüşmez. Bu servis,
 * avukatın tek tek verdiği kararı gerçek kayda (Task / Deadline / TimelineEvent /
 * Hearing / SmartNote) çeviren TEK yerdir.
 *
 * TOPLU ONAY BİLEREK YOKTUR. "Tümünü onayla", okunmadan onaylamayı teşvik eder;
 * süre ve görev kayıtları meslek sorumluluğu doğurur. Her öneri kendi gerekçesi
 * ve kaynak alıntısıyla ayrı ayrı onaylanır.
 *
 * SÜRE ÖNERİLERİNDE İKİNCİ HESAP: hattın hesapladığı son gün ÖNİZLEMEDİR;
 * onay anında deterministik motor YENİDEN çalıştırılır. Aradaki fark (tatil
 * takvimi güncellenmiş olabilir) hesap izine yazılır.
 */
@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly deadlines: DeadlineComputeService,
    // D2 C3: onay/ret kararları eğitim örneği üretir (opt-in kiracıda).
    private readonly training: AiTrainingDataService
  ) {}

  /* ------------------------------------------------------------------ *
   * GET /proposals
   * ------------------------------------------------------------------ */

  async list(
    tenantId: string,
    params: {
      status?: string;
      caseId?: string;
      documentId?: string;
      type?: string;
      page?: string;
      limit?: string;
    }
  ) {
    const where: Prisma.DocumentActionProposalWhereInput = { tenantId };
    const pageParams = resolvePage(params);

    if (params.status) {
      if (!(PROPOSAL_STATUSES as string[]).includes(params.status)) {
        throw new BadRequestException("Geçersiz öneri durumu.");
      }
      where.status = params.status as ProposalStatus;
    }
    if (params.type) {
      if (!(PROPOSAL_TYPES as string[]).includes(params.type)) {
        throw new BadRequestException("Geçersiz öneri tipi.");
      }
      where.type = params.type as ProposalType;
    }
    if (params.caseId) where.caseId = params.caseId;
    if (params.documentId) where.documentId = params.documentId;

    const [items, total] = await Promise.all([
      this.prisma.client.documentActionProposal.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        skip: pageParams.skip,
        take: pageParams.take,
        include: {
          document: { select: { id: true, name: true, class: true, classSource: true } },
          case: { select: { id: true, title: true, fileNumber: true, courtName: true } },
        },
      }),
      this.prisma.client.documentActionProposal.count({ where }),
    ]);

    return paged(items.map(present), total, pageParams);
  }

  async detail(tenantId: string, id: string) {
    const proposal = await this.prisma.client.documentActionProposal.findFirst({
      where: { id, tenantId },
      include: {
        document: { select: { id: true, name: true, class: true, classSource: true } },
        case: { select: { id: true, title: true, fileNumber: true, courtName: true } },
      },
    });
    if (!proposal) {
      throw new NotFoundException("Öneri bulunamadı.");
    }
    return present(proposal);
  }

  /* ------------------------------------------------------------------ *
   * POST /proposals/:id/approve — ÖNERİYİ GERÇEK KAYDA ÇEVİR
   * ------------------------------------------------------------------ */

  async approve(user: AuthUser, id: string, input: ApproveProposalInput) {
    const proposal = await this.requirePending(user.tenantId, id);
    assertRole(
      user,
      LEGAL_DECISION_TYPES.includes(proposal.type) ? ROLE_SETS.HUKUKI : ROLE_SETS.OPERASYON,
      `${proposal.type} önerisi onaylama`
    );

    const payload = parsePayload(proposal.payloadJson);
    let applied: { entity: string; entityId: string; summary: string; extra?: unknown };

    switch (proposal.type) {
      case "GOREV":
        applied = await this.applyTask(user, proposal, payload, input);
        break;
      case "SURE":
        applied = await this.applyDeadline(user, proposal, payload, input);
        break;
      case "SAFAHAT":
        applied = await this.applyTimelineEvent(user, proposal, payload, input);
        break;
      case "DOSYA_ESLESTIRME":
        applied = await this.applyCaseLink(user, proposal, payload, input);
        break;
      case "DURUSMA_GUNCELLEME":
        applied = await this.applyHearing(user, proposal, payload, input);
        break;
      case "MUVEKKIL_BILGILENDIRME":
        applied = await this.applyClientBrief(user, proposal, payload, input);
        break;
      default:
        throw new BadRequestException(`«${proposal.type}» tipi öneri Faz 2'de uygulanamıyor.`);
    }

    const updated = await this.prisma.client.documentActionProposal.update({
      where: { id },
      data: {
        status: "UYGULANDI",
        decidedBy: user.userId,
        decidedAt: new Date(),
        payloadJson: JSON.stringify({
          ...payload,
          applied: { entity: applied.entity, entityId: applied.entityId, at: new Date().toISOString() },
          approvalNote: input.note,
        }),
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PROPOSAL_APPROVE",
      entity: "DocumentActionProposal",
      entityId: id,
      detail:
        `${proposal.type}: ${proposal.title} → ${applied.entity} #${applied.entityId}. ${applied.summary}` +
        (input.note ? ` Not: ${input.note}` : ""),
    });

    // D2 C3: ONAY kararı eğitim örneği üretir — yalnız opt-in kiracıda,
    // model girdisi/çıktısı KVKK maskesinden geçer, avukat kararı etiket olarak yazılır.
    void this.training
      .recordDecision({
        tenantId: user.tenantId,
        taskType: "DOCUMENT_ACTION",
        kind: "ONAY",
        modelInput: { documentId: proposal.documentId, type: proposal.type, title: proposal.title },
        modelOutput: payload,
        feedback: { decision: "ONAY", note: input.note ?? null },
        userId: user.userId,
      })
      .catch(() => undefined);

    return {
      proposal: present(updated),
      created: { entity: applied.entity, id: applied.entityId, summary: applied.summary },
      detail: applied.extra,
    };
  }

  /* ------------------------------------------------------------------ *
   * POST /proposals/:id/reject
   * ------------------------------------------------------------------ */

  async reject(user: AuthUser, id: string, input: RejectProposalInput) {
    const proposal = await this.requirePending(user.tenantId, id);
    // Süre önerisini reddetmek, kaçırılmış süre riskini üstlenmektir.
    assertRole(
      user,
      proposal.type === "SURE" ? ROLE_SETS.HUKUKI : ROLE_SETS.OPERASYON,
      `${proposal.type} önerisi reddetme`
    );

    const payload = parsePayload(proposal.payloadJson);
    const updated = await this.prisma.client.documentActionProposal.update({
      where: { id },
      data: {
        status: "REDDEDILDI",
        decidedBy: user.userId,
        decidedAt: new Date(),
        payloadJson: JSON.stringify({ ...payload, rejectionReason: input.reason }),
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PROPOSAL_REJECT",
      entity: "DocumentActionProposal",
      entityId: id,
      detail: `${proposal.type}: ${proposal.title} — gerekçe: ${input.reason}`,
    });

    // D2 C3: RET kararı da eğitim örneğidir — öneri neyi yanlış önerdi sorusunun
    // cevabı; maske uygulanır, opt-in şart.
    void this.training
      .recordDecision({
        tenantId: user.tenantId,
        taskType: "DOCUMENT_ACTION",
        kind: "RED",
        modelInput: { documentId: proposal.documentId, type: proposal.type, title: proposal.title },
        modelOutput: payload,
        feedback: { decision: "RED", reason: input.reason },
        userId: user.userId,
      })
      .catch(() => undefined);

    return { id: updated.id, status: updated.status, reason: input.reason };
  }

  /* ------------------------------------------------------------------ *
   * Uygulayıcılar
   * ------------------------------------------------------------------ */

  /** GOREV → Task (+ durum günlüğü). */
  private async applyTask(
    user: AuthUser,
    proposal: DocumentActionProposal,
    payload: Record<string, unknown>,
    input: ApproveProposalInput
  ) {
    const caseId = input.caseId ?? proposal.caseId ?? null;
    if (caseId) await this.requireCase(user.tenantId, caseId);

    const assigneeId = input.assigneeId ?? (caseId ? await this.responsibleUserOf(user.tenantId, caseId) : null);
    if (!assigneeId) {
      throw new BadRequestException(
        "Görev için sorumlu belirlenemedi. Dosyanın sorumlu avukatı atanmadığından " +
          "onay isteğinde assigneeId gönderin."
      );
    }
    await this.requireTenantUser(user.tenantId, assigneeId);

    const title = input.title ?? asString(payload.title) ?? proposal.title;
    const description = [
      asString(payload.description),
      `Kaynak belge önerisi (#${proposal.documentId}).`,
      proposal.sourceQuote ? `Belgeden alıntı: «${proposal.sourceQuote}»` : null,
      proposal.reasoning ? `Gerekçe: ${proposal.reasoning}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const task = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          tenantId: user.tenantId,
          caseId,
          title: title.slice(0, 300),
          description,
          assigneeId,
          priority: asPriority(payload.priority),
          dueDate: input.dueDate ?? null,
        },
      });
      await tx.taskStatusLog.create({
        data: {
          taskId: created.id,
          fromStatus: null,
          toStatus: created.status,
          userId: user.userId,
          note: "Belge hattı önerisi onaylanarak açıldı.",
        },
      });
      return created;
    });

    if (caseId) await touchCase(this.prisma.client, caseId);
    return { entity: "Task", entityId: task.id, summary: `Görev açıldı: ${task.title}` };
  }

  /**
   * SURE → Deadline.
   *
   * SON GÜN BURADA YENİDEN HESAPLANIR. AI'ın önerdiği tarih hiçbir koşulda
   * doğrudan yazılmaz; yazılan tarih daima `@nomosos/legal-core` çıktısıdır.
   */
  private async applyDeadline(
    user: AuthUser,
    proposal: DocumentActionProposal,
    payload: Record<string, unknown>,
    input: ApproveProposalInput
  ) {
    const caseId = input.caseId ?? proposal.caseId;
    if (!caseId) {
      throw new BadRequestException(
        "Süre kaydı için belge bir dosyaya bağlı olmalıdır. Önce dosya eşleştirme önerisini onaylayın."
      );
    }
    const relatedCase = await this.requireCase(user.tenantId, caseId);

    const ruleKey = input.ruleKey ?? asString(payload.ruleKey) ?? asString(payload.suggestedRuleKey);
    if (!ruleKey) {
      throw new BadRequestException("Süre kuralı belirtilmedi; onay isteğinde ruleKey gönderin.");
    }

    const triggerDate = input.triggerDate ?? parseIsoDate(asString(payload.eventDate));
    if (!triggerDate) {
      throw new BadRequestException(
        "Süreyi başlatan olay tarihi okunamadı; onay isteğinde triggerDate gönderin."
      );
    }

    const outcome = await this.deadlines.compute({
      tenantId: user.tenantId,
      ruleKey,
      triggerDate,
      serviceMethod: input.serviceMethod,
    });
    if (!outcome.ok || !outcome.dueDate) {
      throw new BadRequestException(
        outcome.error ??
          "Süre hesaplanamadı. Uygulanacak kuralı seçip (ruleKey) yeniden deneyin; " +
            "AI'nın önerdiği tarih hesaba esas alınmaz."
      );
    }

    const previewDue = asString(payload.dueDate);
    const drift =
      previewDue && previewDue !== outcome.dueDate.toISOString().slice(0, 10)
        ? `Öneri anındaki önizleme (${previewDue}) ile onay anındaki hesap (${outcome.dueDate
            .toISOString()
            .slice(0, 10)}) farklıdır; geçerli olan onay anındaki deterministik hesaptır.`
        : null;

    const computeNote = [
      outcome.computeNote,
      `Tespit kaynağı: belge #${proposal.documentId} — AI süre TESPİTİ, hesap deterministik motordan.`,
      proposal.sourceQuote ? `Belgeden alıntı: «${proposal.sourceQuote}»` : null,
      drift,
      input.note ? `Onay notu: ${input.note}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const title = input.title ?? outcome.ruleName ?? asString(payload.eventDescription) ?? proposal.title;

    const deadline = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.deadline.create({
        data: {
          tenantId: user.tenantId,
          caseId,
          title: title.slice(0, 300),
          dueDate: outcome.dueDate as Date,
          ownerId: input.assigneeId ?? relatedCase.responsibleUserId ?? undefined,
          // Tespit AI'dan geldiği için kaynak AI_ONERISI; ancak avukat onayladığı
          // için durum ONAYLANDI'dır ve son gün motordan gelmiştir.
          source: "AI_ONERISI",
          status: "ONAYLANDI",
          legalBasis: outcome.legalBasis,
          computeNote,
          ruleKey: outcome.ruleKey,
          triggerDate,
          serviceMethod: input.serviceMethod,
        },
      });
      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId,
          userId: user.userId,
          title: `Süre kaydedildi: ${created.title} — son gün ${formatTrDate(created.dueDate)}`,
          detail: computeNote,
          source: "AI",
        },
      });
      return created;
    });

    await touchCase(this.prisma.client, caseId);
    return {
      entity: "Deadline",
      entityId: deadline.id,
      summary: `Süre kaydı açıldı — son gün ${formatTrDate(deadline.dueDate)} (${outcome.legalBasis}).`,
      extra: { steps: outcome.steps, warnings: outcome.warnings, drift },
    };
  }

  /** SAFAHAT → TimelineEvent. */
  private async applyTimelineEvent(
    user: AuthUser,
    proposal: DocumentActionProposal,
    payload: Record<string, unknown>,
    input: ApproveProposalInput
  ) {
    const caseId = input.caseId ?? proposal.caseId;
    if (!caseId) {
      throw new BadRequestException("Safahat kaydı için belge bir dosyaya bağlı olmalıdır.");
    }
    await this.requireCase(user.tenantId, caseId);

    const event = await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        userId: user.userId,
        date: parseIsoDate(asString(payload.date)) ?? new Date(),
        title: (input.title ?? asString(payload.title) ?? proposal.title).slice(0, 300),
        detail: asString(payload.detail),
        source: "AI",
      },
    });
    await touchCase(this.prisma.client, caseId);
    return { entity: "TimelineEvent", entityId: event.id, summary: `Safahata işlendi: ${event.title}` };
  }

  /** DOSYA_ESLESTIRME → Document.caseId (+ parçalar ve bekleyen öneriler). */
  private async applyCaseLink(
    user: AuthUser,
    proposal: DocumentActionProposal,
    payload: Record<string, unknown>,
    input: ApproveProposalInput
  ) {
    const candidates = Array.isArray(payload.candidates)
      ? (payload.candidates as Array<Record<string, unknown>>)
      : [];
    const caseId =
      input.caseId ?? (candidates.length === 1 ? asString(candidates[0]?.caseId) : undefined);
    if (!caseId) {
      throw new BadRequestException(
        "Belgenin bağlanacağı dosya seçilmedi. Onay isteğinde caseId gönderin " +
          `(öneri ${candidates.length} aday içeriyor).`
      );
    }
    const relatedCase = await this.requireCase(user.tenantId, caseId);

    // SAVUNMA DERİNLİĞİ: her toplu yazma kendi tenantId koşulunu taşır.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.document.updateMany({
        where: { id: proposal.documentId, tenantId: user.tenantId },
        data: { caseId },
      });
      await tx.documentChunk.updateMany({
        where: { documentId: proposal.documentId, tenantId: user.tenantId },
        data: { caseId },
      });
      await tx.documentActionProposal.updateMany({
        where: { documentId: proposal.documentId, tenantId: user.tenantId, status: "BEKLIYOR" },
        data: { caseId },
      });
    });

    await touchCase(this.prisma.client, caseId);
    return {
      entity: "Document",
      entityId: proposal.documentId,
      summary: `Belge «${relatedCase.fileNumber ?? relatedCase.title}» dosyasına bağlandı.`,
    };
  }

  /** DURUSMA_GUNCELLEME → Hearing (mevcutu güncelle veya yeni kayıt). */
  private async applyHearing(
    user: AuthUser,
    proposal: DocumentActionProposal,
    payload: Record<string, unknown>,
    input: ApproveProposalInput
  ) {
    const caseId = input.caseId ?? proposal.caseId;
    if (!caseId) {
      throw new BadRequestException("Duruşma güncellemesi için belge bir dosyaya bağlı olmalıdır.");
    }
    await this.requireCase(user.tenantId, caseId);

    const newDate = parseIsoDate(asString(payload.newDate));
    if (!newDate) {
      throw new BadRequestException("Öneride geçerli bir duruşma tarihi bulunamadı.");
    }

    const target = input.hearingId
      ? await this.prisma.client.hearing.findFirst({
          where: { id: input.hearingId, tenantId: user.tenantId, caseId },
          select: { id: true, date: true },
        })
      : await this.prisma.client.hearing.findFirst({
          where: { tenantId: user.tenantId, caseId, status: "PLANLANDI" },
          orderBy: { date: "asc" },
          select: { id: true, date: true },
        });

    let hearingId: string;
    let summary: string;
    if (target) {
      const updated = await this.prisma.client.hearing.update({
        where: { id: target.id },
        data: { date: newDate, note: appendNote(proposal.sourceQuote) },
      });
      hearingId = updated.id;
      summary = `Duruşma ${formatTrDate(target.date)} → ${formatTrDate(newDate)} olarak güncellendi.`;
    } else {
      const created = await this.prisma.client.hearing.create({
        data: {
          tenantId: user.tenantId,
          caseId,
          date: newDate,
          type: "DURUSMA",
          status: "PLANLANDI",
          note: appendNote(proposal.sourceQuote),
        },
      });
      hearingId = created.id;
      summary = `Yeni duruşma kaydı açıldı: ${formatTrDate(newDate)}.`;
    }

    await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        userId: user.userId,
        title: summary,
        detail: proposal.sourceQuote ? `Belgeden alıntı: «${proposal.sourceQuote}»` : undefined,
        source: "AI",
      },
    });
    await refreshCaseDenormals(this.prisma.client, caseId);
    return { entity: "Hearing", entityId: hearingId, summary };
  }

  /** MUVEKKIL_BILGILENDIRME → onaylanmış SmartNote (gönderim kanalı Faz 5). */
  private async applyClientBrief(
    user: AuthUser,
    proposal: DocumentActionProposal,
    payload: Record<string, unknown>,
    input: ApproveProposalInput
  ) {
    const caseId = input.caseId ?? proposal.caseId;
    if (!caseId) {
      throw new BadRequestException("Müvekkil bilgilendirmesi için belge bir dosyaya bağlı olmalıdır.");
    }
    await this.requireCase(user.tenantId, caseId);

    const content = asString(payload.message) ?? asString(payload.detail) ?? proposal.title;
    const note = await this.prisma.client.smartNote.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        userId: user.userId,
        content,
        kind: "GENEL",
        source: "AI",
        // Avukat onayladı; yine de GÖNDERİM ayrı bir eylemdir (Faz 5).
        isApproved: true,
      },
    });
    await touchCase(this.prisma.client, caseId);
    return {
      entity: "SmartNote",
      entityId: note.id,
      summary: "Müvekkil bilgilendirme taslağı onaylandı; gönderim ayrıca yapılır.",
    };
  }

  /* ------------------------------------------------------------------ *
   * Yardımcılar
   * ------------------------------------------------------------------ */

  private async requirePending(tenantId: string, id: string): Promise<DocumentActionProposal> {
    const proposal = await this.prisma.client.documentActionProposal.findFirst({
      where: { id, tenantId },
    });
    if (!proposal) {
      throw new NotFoundException("Öneri bulunamadı.");
    }
    if (proposal.status !== "BEKLIYOR") {
      throw new BadRequestException(
        `Bu öneri zaten ${proposal.status} durumunda; karar bir kez verilir (denetim izi korunur).`
      );
    }
    return proposal;
  }

  private async requireCase(tenantId: string, caseId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, title: true, fileNumber: true, responsibleUserId: true },
    });
    if (!found) {
      throw new BadRequestException("Dosya bulunamadı.");
    }
    return found;
  }

  private async responsibleUserOf(tenantId: string, caseId: string): Promise<string | null> {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { responsibleUserId: true },
    });
    return found?.responsibleUserId ?? null;
  }

  private async requireTenantUser(tenantId: string, userId: string) {
    const found = await this.prisma.client.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });
    if (!found) {
      throw new BadRequestException("Seçilen sorumlu büronuzda bulunamadı.");
    }
    return found;
  }
}

/** payloadJson'u nesneye çevirir; bozuksa boş nesne (onay akışı çökmez). */
function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Öneriyi API cevabında payloadJson yerine çözülmüş `payload` ile sunar. */
function present<T extends { payloadJson: string }>(proposal: T) {
  const { payloadJson, ...rest } = proposal;
  return { ...rest, payload: parsePayload(payloadJson) };
}

const TASK_PRIORITY_VALUES: TaskPriority[] = ["DUSUK", "NORMAL", "YUKSEK", "KRITIK"];

/** payloadJson bozuksa bile geçerli bir öncelik döndürür (Prisma enum hatası olmasın). */
function asPriority(value: unknown): TaskPriority {
  return typeof value === "string" && (TASK_PRIORITY_VALUES as string[]).includes(value)
    ? (value as TaskPriority)
    : "NORMAL";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseIsoDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function appendNote(sourceQuote: string | null): string | undefined {
  return sourceQuote ? `Belge hattı önerisiyle güncellendi. Alıntı: «${sourceQuote}»` : undefined;
}
