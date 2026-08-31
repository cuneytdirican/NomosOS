import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { hasRole, ROLE_LABELS, ROLE_SETS } from "../common/roles";
import {
  addDays,
  endOfDay,
  endOfWeek,
  formatTrDate,
  startOfDay,
  startOfWeek,
} from "../common/dates";
import { AssistantLlmService } from "./assistant-llm.service";
import {
  buildLocalMessages,
  officeQueryPrompt,
  OfficeQueryPlanSchema,
  type OfficeQueryEntity,
  type OfficeQueryPlan,
} from "./assistant.prompts";
import type { OfficeQueryInput } from "./assistant.dto";

export interface OfficeQueryRow {
  id: string;
  /** Kullanıcıya gösterilecek satır metni. */
  label: string;
  /** Tıklanabilir dosya bağlantısı için. */
  caseId?: string;
  caseTitle?: string;
  date?: string;
  status?: string;
}

export interface OfficeQueryResult {
  question: string;
  plan: OfficeQueryPlan;
  rows: OfficeQueryRow[];
  count: number;
  answer: string;
  model: string;
  usageLogId: string;
  advisory: { isAdvisory: true; notice: string };
  /** Veri minimizasyonunun kullanıcıya görünen beyanı. */
  dataMinimization: {
    rowsSentToLlm: 0;
    explanation: string;
  };
  scopeNote: string;
}

const DATA_MINIMIZATION_EXPLANATION =
  "KVKK veri minimizasyonu: dil modeline yalnızca sorunuzun metni ve sorgu planı şeması " +
  "gönderildi. Hiçbir müvekkil, dosya, süre veya tutar SATIR VERİSİ modele iletilmedi; " +
  "sorguyu NomosOS kendi veritabanında çalıştırdı ve sonucu şablonla Türkçeye çevirdi.";

/**
 * Büro geneli asistan — "bu hafta hangi dosyalarda süre var?"
 *
 * VERİ MİNİMİZASYONU DESENİ (Modül 24, iş kuralı 5):
 *   1. LLM'e giden tek şey KULLANICININ SORUSU + plan şemasının açıklamasıdır.
 *   2. LLM yalnızca yapılandırılmış bir SORGU PLANI üretir (zod ile doğrulanır).
 *   3. Sorguyu API çalıştırır — daima `tenantId` süzgeçli, daima rol kontrollü.
 *   4. Sonuç, modelin verdiği ŞABLONA yerleştirilerek Türkçe metne çevrilir.
 *   Model hiçbir aşamada satır verisi görmez; `dataMinimization.rowsSentToLlm` = 0
 *   bu sözleşmenin yanıttaki beyanıdır.
 *
 * RBAC MİRASI (iş kuralı 4): asistan kullanıcının yetkisini aşamaz. STAJYER
 * rolü finans varlığını sorgulayamaz; plan FINANCIAL isterse istek reddedilir ve
 * hiçbir finans kaydı okunmaz.
 */
@Injectable()
export class OfficeQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: AssistantLlmService,
    private readonly audit: AuditService,
  ) {}

  async run(user: AuthUser, input: OfficeQueryInput): Promise<OfficeQueryResult> {
    // (1) LLM'e giden içerik: YALNIZCA soru metni.
    const messages = buildLocalMessages(officeQueryPrompt, `SORU: ${input.question}`);

    const run = await this.llm.runTask({
      user,
      routeKeys: ["OFFICE_QUERY", "DAILY_PRIORITIZE", "CASE_CHAT"],
      logTaskType: "OFFICE_QUERY",
      messages,
      schema: OfficeQueryPlanSchema,
      // Plan bir "bulgu" değildir; kaynaksız eleme uygulanmaz.
      findingPaths: [],
      // Soru metni KVKK taramasından geçer (runTask içinde). Onay bayrağı artık
      // ÇAĞIRANDAN gelir (İ-18): sabit `false` geçilince, sorusunda TCKN geçen
      // kullanıcı 409 alıyor ve 409'un istediği onayı verebileceği hiçbir yol
      // bulunmuyordu — uç kalıcı olarak kırılıyordu.
      piiApproved: input.piiApproved,
      maxTokens: 1024,
      auditDetail: "veriMinimizasyonu=satirVerisiGonderilmedi",
    });

    const plan = run.data;

    // (2) RBAC kapısı — plan çalıştırılmadan ÖNCE.
    await this.assertEntityAllowed(user, plan.entity, input.question);

    // (3) Sorguyu API çalıştırır.
    const rows = await this.execute(user, plan);

    // (4) Şablonla Türkçeleştirme.
    const answer = this.render(plan, rows);

    return {
      question: input.question,
      plan,
      rows,
      count: rows.length,
      answer,
      model: run.model,
      usageLogId: run.usageLogId,
      advisory: run.advisory,
      dataMinimization: { rowsSentToLlm: 0, explanation: DATA_MINIMIZATION_EXPLANATION },
      scopeNote: `Sonuçlar yalnızca kendi büronuzun (tenant) kayıtları üzerinde, ${ROLE_LABELS[user.role]} rolünüzün yetkisiyle sınırlıdır.`,
    };
  }

  /**
   * RBAC MİRASI (Modül 24, iş kuralı 4): asistan kullanıcının yetkisini AŞAMAZ.
   *
   * [DÜZELTME] Eskiden yalnızca `entity === "FINANCIAL" && role === "STAJYER"`
   * reddediliyordu. Bu bir KARA LİSTEDİR ve iki açığı vardı:
   *   1. SEKRETER rolü — dosya üzerinde hukuki tasarruf yetkisi olmayan bir rol —
   *      asistan üzerinden FinancialEntry satırlarını (tarih, tür, tutar, dosya)
   *      okuyabiliyordu.
   *   2. Yeni bir rol eklendiğinde kapı SESSİZCE açılıyordu.
   * Artık BEYAZ LİSTE (`ROLE_SETS.FINANS`) kullanılıyor ve her ret AuditLog'a
   * yazılıyor.
   */
  private async assertEntityAllowed(
    user: AuthUser,
    entity: OfficeQueryEntity,
    question: string,
  ): Promise<void> {
    if (entity !== "FINANCIAL") return;
    if (hasRole(user, ROLE_SETS.FINANS)) return;

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_OFFICE_QUERY_DENIED",
      entity: "FinancialEntry",
      detail:
        `rol=${user.role} varlık=FINANCIAL — rol yetkisi olmadığı için sorgu çalıştırılmadı. ` +
        `Soru: ${question.slice(0, 200)}`,
    });

    throw new ForbiddenException(
      `${ROLE_LABELS[user.role]} rolü finansal verilere erişemez; bu soru asistan üzerinden ` +
        "yanıtlanamaz. Rol yetkileri AI katmanında da geçerlidir.",
    );
  }

  /** Plan → tarih aralığı. Gün sınırları UTC sözleşmesiyle (common/dates) hesaplanır. */
  private resolveRange(plan: OfficeQueryPlan): { from?: Date; to?: Date; overdue: boolean } {
    if (plan.dateFrom || plan.dateTo) {
      return {
        from: plan.dateFrom ? startOfDay(new Date(plan.dateFrom)) : undefined,
        to: plan.dateTo ? endOfDay(new Date(plan.dateTo)) : undefined,
        overdue: false,
      };
    }
    const now = new Date();
    switch (plan.datePreset) {
      case "BUGUN":
        return { from: startOfDay(now), to: endOfDay(now), overdue: false };
      case "YARIN":
        return { from: startOfDay(addDays(now, 1)), to: endOfDay(addDays(now, 1)), overdue: false };
      case "BU_HAFTA":
        return { from: startOfWeek(now), to: endOfWeek(now), overdue: false };
      case "GELECEK_HAFTA": {
        const next = addDays(startOfWeek(now), 7);
        return { from: next, to: endOfDay(addDays(next, 6)), overdue: false };
      }
      case "BU_AY": {
        const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
        return { from: first, to: endOfDay(last), overdue: false };
      }
      case "GELECEK_30_GUN":
        return { from: startOfDay(now), to: endOfDay(addDays(now, 30)), overdue: false };
      case "GECMIS_30_GUN":
        return { from: startOfDay(addDays(now, -30)), to: endOfDay(now), overdue: false };
      case "GECIKMIS":
        return { from: undefined, to: startOfDay(now), overdue: true };
      case "TUMU":
      default:
        return { from: undefined, to: undefined, overdue: false };
    }
  }

  private async execute(user: AuthUser, plan: OfficeQueryPlan): Promise<OfficeQueryRow[]> {
    const { from, to } = this.resolveRange(plan);
    const range =
      from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
    const order = plan.sort === "DESC" ? "desc" : "asc";
    const take = plan.limit;
    const text = plan.textContains?.trim();

    switch (plan.entity) {
      case "DEADLINE": {
        // statuses değerleri LLM'den gelir; Prisma enum'una güvenli biçimde SÜZERİZ
        // (modelin uydurduğu bir durum adı sorguya giremez).
        const statuses = this.filterEnum(plan.statuses, [
          "BEKLIYOR",
          "ONAYLANDI",
          "TAMAMLANDI",
          "KACIRILDI",
          "IPTAL",
        ]);
        const where = {
          tenantId: user.tenantId,
          ...(range ? { dueDate: range } : {}),
          ...(statuses.length ? { status: { in: statuses } } : {}),
          ...(plan.onlyMine ? { ownerId: user.userId } : {}),
          ...(text ? { title: { contains: text, mode: "insensitive" } } : {}),
        } as Prisma.DeadlineWhereInput;

        const rows = await this.prisma.client.deadline.findMany({
          where,
          include: { case: { select: { id: true, title: true, fileNumber: true } } },
          orderBy: { dueDate: order },
          take,
        });
        return rows.map((d) => ({
          id: d.id,
          label: `${formatTrDate(d.dueDate)} — ${d.title} (${d.case.fileNumber ?? d.case.title})`,
          caseId: d.caseId,
          caseTitle: d.case.title,
          date: d.dueDate.toISOString().slice(0, 10),
          status: d.status,
        }));
      }

      case "TASK": {
        const statuses = this.filterEnum(plan.statuses, [
          "ACIK",
          "DEVAM_EDIYOR",
          "KONTROLDE",
          "ONAY_BEKLIYOR",
          "TAMAMLANDI",
          "IPTAL",
        ]);
        const rows = await this.prisma.client.task.findMany({
          where: {
            tenantId: user.tenantId,
            ...(range ? { dueDate: range } : {}),
            ...(statuses.length ? { status: { in: statuses } } : {}),
            ...(plan.onlyMine ? { assigneeId: user.userId } : {}),
            ...(text ? { title: { contains: text, mode: "insensitive" } } : {}),
          } as Prisma.TaskWhereInput,
          include: { case: { select: { id: true, title: true, fileNumber: true } } },
          orderBy: { dueDate: order },
          take,
        });
        return rows.map((t) => ({
          id: t.id,
          label: `${t.dueDate ? formatTrDate(t.dueDate) : "Tarihsiz"} — ${t.title}${
            t.case ? ` (${t.case.fileNumber ?? t.case.title})` : ""
          }`,
          caseId: t.caseId ?? undefined,
          caseTitle: t.case?.title,
          date: t.dueDate?.toISOString().slice(0, 10),
          status: t.status,
        }));
      }

      case "HEARING": {
        const statuses = this.filterEnum(plan.statuses, [
          "PLANLANDI",
          "YAPILDI",
          "ERTELENDI",
          "IPTAL",
        ]);
        const rows = await this.prisma.client.hearing.findMany({
          where: {
            tenantId: user.tenantId,
            ...(range ? { date: range } : {}),
            ...(statuses.length ? { status: { in: statuses } } : {}),
          } as Prisma.HearingWhereInput,
          include: { case: { select: { id: true, title: true, fileNumber: true, courtName: true } } },
          orderBy: { date: order },
          take,
        });
        return rows.map((h) => ({
          id: h.id,
          label: `${formatTrDate(h.date)} — ${h.case.courtName ?? "Mahkeme belirtilmemiş"} (${
            h.case.fileNumber ?? h.case.title
          })`,
          caseId: h.caseId,
          caseTitle: h.case.title,
          date: h.date.toISOString().slice(0, 10),
          status: h.status,
        }));
      }

      case "CASE": {
        const statuses = this.filterEnum(plan.statuses, [
          "ACIK",
          "DERDEST",
          "KARAR",
          "ISTINAF",
          "TEMYIZ",
          "KESINLESTI",
          "ICRADA",
          "KAPANDI",
          "ARSIV",
        ]);
        const rows = await this.prisma.client.case.findMany({
          where: {
            tenantId: user.tenantId,
            ...(range ? { openedAt: range } : {}),
            ...(statuses.length ? { status: { in: statuses } } : {}),
            ...(plan.onlyMine ? { responsibleUserId: user.userId } : {}),
            ...(text ? { title: { contains: text, mode: "insensitive" } } : {}),
          } as Prisma.CaseWhereInput,
          select: { id: true, title: true, fileNumber: true, status: true, openedAt: true },
          orderBy: { openedAt: order },
          take,
        });
        return rows.map((c) => ({
          id: c.id,
          label: `${c.fileNumber ?? "Esas no yok"} — ${c.title} (${c.status})`,
          caseId: c.id,
          caseTitle: c.title,
          date: c.openedAt.toISOString().slice(0, 10),
          status: c.status,
        }));
      }

      case "CLIENT": {
        const rows = await this.prisma.client.client.findMany({
          where: {
            tenantId: user.tenantId,
            isActive: true,
            ...(text ? { name: { contains: text, mode: "insensitive" } } : {}),
          },
          select: { id: true, name: true, type: true, _count: { select: { cases: true } } },
          orderBy: { name: order },
          take,
        });
        return rows.map((c) => ({
          id: c.id,
          label: `${c.name} (${c.type}) — ${c._count.cases} dosya`,
        }));
      }

      case "FINANCIAL": {
        const rows = await this.prisma.client.financialEntry.findMany({
          where: {
            tenantId: user.tenantId,
            ...(range ? { date: range } : {}),
            ...(text ? { description: { contains: text, mode: "insensitive" } } : {}),
          },
          include: { case: { select: { id: true, title: true, fileNumber: true } } },
          orderBy: { date: order },
          take,
        });
        return rows.map((f) => ({
          id: f.id,
          label: `${formatTrDate(f.date)} — ${f.type} ${f.amount.toString()} ${f.currency}${
            f.case ? ` (${f.case.fileNumber ?? f.case.title})` : ""
          }`,
          caseId: f.caseId ?? undefined,
          caseTitle: f.case?.title,
          date: f.date.toISOString().slice(0, 10),
          status: f.type,
        }));
      }
    }
  }

  /** LLM'in ürettiği durum değerlerini bilinen enum listesine indirger. */
  private filterEnum(values: readonly string[], allowed: readonly string[]): string[] {
    return values.filter((v) => allowed.includes(v));
  }

  /** Modelin verdiği şablona GERÇEK verileri API yerleştirir. */
  private render(plan: OfficeQueryPlan, rows: OfficeQueryRow[]): string {
    const list = rows.length
      ? rows.map((r) => `• ${r.label}`).join("\n")
      : "(Kayıt bulunamadı.)";
    const template = plan.answerTemplate.includes("{liste}")
      ? plan.answerTemplate
      : `${plan.answerTemplate}\n{liste}`;
    return template
      .replace(/\{sayi\}/g, String(rows.length))
      .replace(/\{count\}/g, String(rows.length))
      .replace(/\{liste\}/g, list)
      .replace(/\{list\}/g, list);
  }
}
