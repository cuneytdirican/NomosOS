/**
 * MESAJ ŞABLONLARI — CRUD + DETERMİNİSTİK ÇÖZÜMLEME.
 *
 * İki tür şablon vardır:
 *   SİSTEM  (`tenantId = null`, `isSystem = true`) — tüm bürolara açık, SALT
 *           OKUNUR. Bir büronun düzenlemesi diğerlerini etkilerdi.
 *   BÜRO    (`tenantId = <büro>`) — büronun kendi şablonu, tam yetkili.
 *
 * Sistem şablonunu kişiselleştirmek isteyen büro onu KOPYALAR
 * (`POST /message-templates/:id/copy`); böylece hem özgün metin korunur hem de
 * büro kendi sürümünü serbestçe değiştirir.
 *
 * DİKKAT — Postgres NULL semantiği: şemadaki `@@unique([tenantId, key])`
 * kısıtı `tenantId = NULL` satırlarda ETKİSİZDİR (NULL'lar birbirine eşit
 * sayılmaz). Bu yüzden sistem şablonu aranırken `findUnique` KULLANILMAZ;
 * `findFirst({ tenantId: null, key })` kullanılır (Hazırlık raporu, not 6).
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CommChannel, MessageTemplate, Prisma } from "@nomosos/db";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";
import { CommunicationService } from "./communication.service";
import type { CreateTemplateInput, UpdateTemplateInput } from "./communication.dto";
import {
  UnresolvedPlaceholderError,
  autoTemplateContext,
  extractPlaceholders,
  mergeTemplateContext,
  missingPlaceholders,
  renderTemplate,
  type TemplateContext,
} from "./template-render";

export interface RenderRequest {
  clientId: string;
  caseId?: string | null;
  variables?: Record<string, string>;
}

export interface RenderedTemplate {
  subject: string | null;
  body: string;
  /** Hangi yer tutucuların kayıttan, hangilerinin elle geldiği. */
  resolvedFrom: { auto: string[]; manual: string[] };
}

@Injectable()
export class MessageTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly communication: CommunicationService,
  ) {}

  /* ---------------------------------------------------------------- *
   * CRUD
   * ---------------------------------------------------------------- */

  /** Büronun şablonları + sistem şablonları (tek listede, kaynağı belirtilerek). */
  async list(user: AuthUser, query: { channel?: string; includeSystem?: string }) {
    const includeSystem = query.includeSystem !== "false";
    const where: Prisma.MessageTemplateWhereInput = {
      ...(includeSystem
        ? { OR: [{ tenantId: user.tenantId }, { tenantId: null }] }
        : { tenantId: user.tenantId }),
      ...(query.channel ? { channel: query.channel as CommChannel } : {}),
    };

    const items = await this.prisma.client.messageTemplate.findMany({
      where,
      orderBy: [{ isSystem: "asc" }, { name: "asc" }],
    });

    return {
      items: items.map((t) => ({
        ...t,
        /** Arayüz düzenleme düğmesini buna göre kapatır. */
        editable: !t.isSystem && t.tenantId === user.tenantId,
        placeholders: extractPlaceholders(`${t.subject ?? ""}\n${t.body}`),
      })),
      total: items.length,
    };
  }

  /** Tek şablon — sistem şablonları da okunabilir, BAŞKA BÜRONUNKİ okunamaz. */
  async requireTemplate(user: AuthUser, id: string): Promise<MessageTemplate> {
    const found = await this.prisma.client.messageTemplate.findFirst({
      where: { id, OR: [{ tenantId: user.tenantId }, { tenantId: null }] },
    });
    if (!found) throw new NotFoundException("Mesaj şablonu bulunamadı.");
    return found;
  }

  /** Yazma işlemleri için: şablon bu büroya mı ait? */
  private assertWritable(user: AuthUser, template: MessageTemplate): void {
    if (template.isSystem || template.tenantId === null) {
      throw new ForbiddenException(
        "Sistem şablonları değiştirilemez veya silinemez. Kendi sürümünüzü oluşturmak için " +
          "şablonu kopyalayın (POST /message-templates/:id/copy).",
      );
    }
    if (template.tenantId !== user.tenantId) {
      throw new NotFoundException("Mesaj şablonu bulunamadı.");
    }
  }

  async detail(user: AuthUser, id: string) {
    const template = await this.requireTemplate(user, id);
    return {
      ...template,
      editable: !template.isSystem && template.tenantId === user.tenantId,
      placeholders: extractPlaceholders(`${template.subject ?? ""}\n${template.body}`),
    };
  }

  async create(user: AuthUser, input: CreateTemplateInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "mesaj şablonu oluşturma");

    const clash = await this.prisma.client.messageTemplate.findFirst({
      where: { tenantId: user.tenantId, key: input.key },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(`Bu anahtarla bir şablonunuz zaten var: ${input.key}.`);
    }

    const created = await this.prisma.client.messageTemplate.create({
      data: {
        tenantId: user.tenantId,
        key: input.key,
        name: input.name,
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
        isSystem: false,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "MESSAGE_TEMPLATE_CREATE",
      entity: "MessageTemplate",
      entityId: created.id,
      detail: created.key,
    });
    return created;
  }

  async update(user: AuthUser, id: string, input: UpdateTemplateInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "mesaj şablonu güncelleme");
    const template = await this.requireTemplate(user, id);
    this.assertWritable(user, template);

    const updated = await this.prisma.client.messageTemplate.update({
      where: { id: template.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "MESSAGE_TEMPLATE_UPDATE",
      entity: "MessageTemplate",
      entityId: id,
    });
    return updated;
  }

  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.OPERASYON, "mesaj şablonu silme");
    const template = await this.requireTemplate(user, id);
    this.assertWritable(user, template);

    // Şablonu kullanmış giden mesajlar KORUNUR: `OutboundMessage.templateId`
    // ilişkisi `onDelete: SetNull`'dır. Gönderilmiş bir mesajın geçmişi,
    // şablonu silindi diye kaybolmaz.
    await this.prisma.client.messageTemplate.delete({ where: { id: template.id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "MESSAGE_TEMPLATE_DELETE",
      entity: "MessageTemplate",
      entityId: id,
      detail: `${template.key} · ${template.name}`,
    });
    return { deleted: true, id };
  }

  /** Sistem şablonunu büro şablonuna kopyalar (kişiselleştirme yolu). */
  async copy(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.OPERASYON, "mesaj şablonu kopyalama");
    const source = await this.requireTemplate(user, id);

    let key = `${source.key}_KOPYA`;
    for (let i = 2; i <= 20; i++) {
      const clash = await this.prisma.client.messageTemplate.findFirst({
        where: { tenantId: user.tenantId, key },
        select: { id: true },
      });
      if (!clash) break;
      key = `${source.key}_KOPYA_${i}`;
    }

    const created = await this.prisma.client.messageTemplate.create({
      data: {
        tenantId: user.tenantId,
        key,
        name: `${source.name} (kopya)`,
        channel: source.channel,
        subject: source.subject,
        body: source.body,
        isSystem: false,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "MESSAGE_TEMPLATE_COPY",
      entity: "MessageTemplate",
      entityId: created.id,
      detail: `kaynak=${source.id}`,
    });
    return created;
  }

  /* ---------------------------------------------------------------- *
   * Deterministik çözümleme
   * ---------------------------------------------------------------- */

  /**
   * Kayıttan türetilen yer tutucu değerleri.
   *
   * TEK SORGU KÜMESİ, HİÇ AI YOK. Duruşma ve süre için "en yakın gelecek olan"
   * seçilir; geçmiş duruşma bir hatırlatma mesajına konamaz.
   */
  async buildContext(
    user: AuthUser,
    request: RenderRequest,
  ): Promise<{ context: TemplateContext; autoKeys: string[] }> {
    const client = await this.communication.requireClient(user.tenantId, request.clientId);
    const kase = request.caseId
      ? await this.communication.requireCase(user.tenantId, request.caseId, client.id)
      : null;

    const [tenant, hearing, deadline, lawyer] = await Promise.all([
      this.prisma.client.tenant.findUnique({
        where: { id: user.tenantId },
        select: { name: true },
      }),
      kase
        ? this.prisma.client.hearing.findFirst({
            where: {
              tenantId: user.tenantId,
              caseId: kase.id,
              status: { in: ["PLANLANDI", "ERTELENDI"] },
              date: { gte: new Date() },
            },
            orderBy: { date: "asc" },
            select: { date: true },
          })
        : null,
      kase
        ? this.prisma.client.deadline.findFirst({
            where: {
              tenantId: user.tenantId,
              caseId: kase.id,
              status: { in: ["BEKLIYOR", "ONAYLANDI"] },
              dueDate: { gte: new Date() },
            },
            orderBy: { dueDate: "asc" },
            select: { dueDate: true, title: true },
          })
        : null,
      kase?.responsibleUserId
        ? this.prisma.client.user.findFirst({
            where: { id: kase.responsibleUserId, tenantId: user.tenantId },
            select: { fullName: true },
          })
        : this.prisma.client.user.findFirst({
            where: { id: user.userId, tenantId: user.tenantId },
            select: { fullName: true },
          }),
    ]);

    const auto = autoTemplateContext({
      clientName: client.name,
      tenantName: tenant?.name ?? "",
      lawyerName: lawyer?.fullName ?? null,
      case: kase
        ? {
            fileNumber: kase.fileNumber,
            courtName: kase.courtName,
            subject: kase.subject,
            title: kase.title,
            // Prisma.Decimal → dize. Sayıya ÇEVRİLMEZ (ortak karar 5).
            amountDecimalString: kase.amount ? kase.amount.toFixed(2) : null,
          }
        : null,
      hearingAt: hearing?.date ?? null,
      nextDeadlineAt: deadline?.dueDate ?? null,
      nextDeadlineTitle: deadline?.title ?? null,
    });

    const autoKeys = Object.entries(auto)
      .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      .map(([k]) => k);

    return { context: mergeTemplateContext(auto, request.variables), autoKeys };
  }

  /**
   * Şablonu çözer. ÇÖZÜLEMEYEN YER TUTUCU VARSA 400 — boş bırakılmaz.
   *
   * Hata gövdesi eksik değişkenleri ADIYLA döndürür; arayüz doğrudan o alanlar
   * için giriş kutusu açabilir.
   */
  async render(
    user: AuthUser,
    template: Pick<MessageTemplate, "subject" | "body">,
    request: RenderRequest,
  ): Promise<RenderedTemplate> {
    const { context, autoKeys } = await this.buildContext(user, request);

    const combined = `${template.subject ?? ""}\n${template.body}`;
    const missing = missingPlaceholders(combined, context);
    if (missing.length > 0) {
      throw new BadRequestException({
        message: new UnresolvedPlaceholderError(missing).message,
        missingPlaceholders: missing,
        /** Kayıttan gelen ve elle verilmesine gerek olmayan değişkenler. */
        resolvedPlaceholders: extractPlaceholders(combined).filter((p) => !missing.includes(p)),
      });
    }

    const used = extractPlaceholders(combined);
    return {
      subject: template.subject ? renderTemplate(template.subject, context) : null,
      body: renderTemplate(template.body, context),
      resolvedFrom: {
        auto: used.filter((p) => autoKeys.includes(p)),
        manual: used.filter((p) => !autoKeys.includes(p)),
      },
    };
  }

  /** `POST /message-templates/:id/render` — onaya sunmadan önce önizleme. */
  async preview(user: AuthUser, id: string, request: RenderRequest) {
    const template = await this.requireTemplate(user, id);
    const rendered = await this.render(user, template, request);
    return { templateId: template.id, key: template.key, channel: template.channel, ...rendered };
  }
}
