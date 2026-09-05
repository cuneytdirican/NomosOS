/**
 * İletişim Merkezi HTTP uçları (prefix /api/v1).
 *
 *   /communications          → birleşik geçmiş, elle kayıt, zaman çizelgesi
 *   /message-templates       → şablon CRUD + deterministik önizleme
 *   /outbound-messages       → taslak → onay → gönderim hattı
 *   /inbound-messages        → gelen mesaj, eşleştirme, elle bağlama
 *
 * KREDİ HATTI: yalnız İKİ uç `@AiCredits` taşır ve ikisi de KOŞULLUDUR
 * (`when: useAi === true`). Dekoratörsüz uçlar kredi kapısından geçmez;
 * onay, gönderim, şablon çözümü ve deterministik eşleştirme ÜCRETSİZDİR —
 * çünkü hiçbiri sağlayıcıya gitmez.
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AiCredits } from "../credits/ai-credits.decorator";
import type { AuthUser } from "../common/types";
import { ChannelProviderRegistry } from "./channel-providers";
import { CommunicationService } from "./communication.service";
import { InboundService } from "./inbound.service";
import { MessageTemplateService } from "./message-templates.service";
import { OutboundService } from "./outbound.service";
import {
  approveOutboundSchema,
  createCommunicationSchema,
  createInboundSchema,
  createOutboundSchema,
  createTemplateSchema,
  matchInboundSchema,
  rejectOutboundSchema,
  renderTemplateSchema,
  sendOutboundSchema,
  suggestInboundCaseSchema,
  updateCommunicationSchema,
  updateOutboundSchema,
  updateTemplateSchema,
  type ApproveOutboundInput,
  type CreateCommunicationInput,
  type CreateInboundInput,
  type CreateOutboundInput,
  type CreateTemplateInput,
  type MatchInboundInput,
  type RejectOutboundInput,
  type RenderTemplateInput,
  type SendOutboundInput,
  type SuggestInboundCaseInput,
  type UpdateCommunicationInput,
  type UpdateOutboundInput,
  type UpdateTemplateInput,
  clientStatusSummarySchema,
  type ClientStatusSummaryInput,
} from "./communication.dto";

/* ========================================================================== *
 * 1) İletişim geçmişi
 * ========================================================================== */

@Controller("communications")
export class CommunicationsController {
  constructor(
    private readonly communication: CommunicationService,
    private readonly channels: ChannelProviderRegistry,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("clientId") clientId?: string,
    @Query("caseId") caseId?: string,
    @Query("channel") channel?: string,
    @Query("direction") direction?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.communication.list(user, { clientId, caseId, channel, direction, from, to, q, page, limit });
  }

  /**
   * Birleşik kronoloji. `:id` rotasından ÖNCE tanımlıdır, aksi hâlde "timeline"
   * bir kayıt kimliği sanılırdı.
   */
  @Get("timeline")
  timeline(
    @CurrentUser() user: AuthUser,
    @Query("clientId") clientId?: string,
    @Query("caseId") caseId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.communication.timeline(user, { clientId, caseId, limit });
  }

  /** 48 saattir yanıtsız gelen mesajlar (iş kuralı 6). */
  @Get("unanswered")
  unanswered(@CurrentUser() user: AuthUser, @Query("hours") hours?: string) {
    return this.communication.unanswered(user, hours);
  }

  /** Kanal yapılandırma durumu — hangi kanal gerçekten gönderebiliyor? */
  @Get("channels")
  channelStatus() {
    return {
      items: this.channels.status(),
      notice:
        "configured=false olan kanallarda gönderim denemesi 503 döner ve mesaj ONAYLANDI " +
        "durumunda korunur. Sahte gönderim yapılmaz.",
    };
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.communication.detail(user, id);
  }

  /** Telefon/yüz yüze görüşme gibi kanal dışı temasların elle kaydı. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCommunicationSchema)) body: CreateCommunicationInput,
  ) {
    return this.communication.create(user, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCommunicationSchema)) body: UpdateCommunicationInput,
  ) {
    return this.communication.update(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.communication.remove(user, id);
  }
}

/* ========================================================================== *
 * 2) Şablonlar
 * ========================================================================== */

@Controller("message-templates")
export class MessageTemplatesController {
  constructor(private readonly templates: MessageTemplateService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("channel") channel?: string,
    @Query("includeSystem") includeSystem?: string,
  ) {
    return this.templates.list(user, { channel, includeSystem });
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.templates.detail(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTemplateSchema)) body: CreateTemplateInput,
  ) {
    return this.templates.create(user, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) body: UpdateTemplateInput,
  ) {
    return this.templates.update(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.templates.remove(user, id);
  }

  /** Sistem şablonunu büro şablonuna kopyalar (kişiselleştirme yolu). */
  @Post(":id/copy")
  copy(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.templates.copy(user, id);
  }

  /**
   * ÖNİZLEME — AI YOK, KREDİ YOK.
   *
   * Yer tutucular kayıttan deterministik olarak çözülür. Çözülemeyen değişken
   * varsa 400 + `missingPlaceholders`; boş metin ÜRETİLMEZ (kabul kriteri 9).
   */
  @Post(":id/render")
  @HttpCode(200)
  render(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(renderTemplateSchema)) body: RenderTemplateInput,
  ) {
    return this.templates.preview(user, id, {
      clientId: body.clientId,
      caseId: body.caseId ?? null,
      variables: body.variables,
    });
  }
}

/* ========================================================================== *
 * 3) Giden mesaj — onay hattı
 * ========================================================================== */

@Controller("outbound-messages")
export class OutboundMessagesController {
  constructor(private readonly outbound: OutboundService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("clientId") clientId?: string,
    @Query("caseId") caseId?: string,
    @Query("channel") channel?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.outbound.list(user, { status, clientId, caseId, channel, page, limit });
  }

  /** Onay kuyruğu — `:id` rotasından ÖNCE. */
  @Get("approvals")
  approvals(
    @CurrentUser() user: AuthUser,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.outbound.approvalQueue(user, { page, limit });
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.outbound.detail(user, id);
  }

  /**
   * Taslak oluştur.
   *
   * KREDİ YALNIZ `useAi: true` İKEN: şablondan veya elle üretilen taslak
   * sağlayıcıya hiç gitmez, dolayısıyla ücretlendirilmesi yanlış olurdu.
   * `caseIdFrom`, uzun dosya bağlamının tahmine girmesini sağlar — aksi hâlde
   * 50 kredilik istek tavanı bu uçta hiç tetiklenmezdi.
   */
  @Post()
  @AiThrottle(1)
  @AiCredits("MESSAGE_DRAFT", {
    when: (body) => (body as { useAi?: unknown } | undefined)?.useAi === true,
    caseIdFrom: (body) => (body as { caseId?: string } | undefined)?.caseId,
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createOutboundSchema)) body: CreateOutboundInput,
  ) {
    return this.outbound.create(user, body);
  }

  /**
   * Faz 7F — CLIENT_STATUS_SUMMARY ucu: dosya için müvekkile yönelik SADE DİL durum özeti
   * TASLAĞI. Mesaj kaydı AÇMAZ; avukat okur, düzenler, mesaj/portal notu olarak kendisi kullanır.
   * Bağlam `buildClientFacingCaseContext` ile kurulur (strateji/risk/iç not model'e gitmez).
   */
  @Post("client-status-summary")
  @HttpCode(200)
  @AiThrottle(1)
  @AiCredits("CLIENT_STATUS_SUMMARY", { caseIdFrom: (body) => (body as { caseId?: string } | undefined)?.caseId })
  clientStatusSummary(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(clientStatusSummarySchema)) body: ClientStatusSummaryInput,
  ) {
    return this.outbound.clientStatusSummary(user, body);
  }

  /** Metni düzenle. ONAYLANMIŞ mesajda onayı DÜŞÜRÜR. */
  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateOutboundSchema)) body: UpdateOutboundInput,
  ) {
    return this.outbound.update(user, id, body);
  }

  /** Taslağı onay kuyruğuna sun (sekreter → avukat). */
  @Post(":id/submit")
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.outbound.submit(user, id);
  }

  /** ONAY — `approvedBy` burada dolar. AVUKAT ve üstü. */
  @Post(":id/approve")
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(approveOutboundSchema)) body: ApproveOutboundInput,
  ) {
    return this.outbound.approve(user, id, body);
  }

  @Post(":id/reject")
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rejectOutboundSchema)) body: RejectOutboundInput,
  ) {
    return this.outbound.reject(user, id, body);
  }

  /** GÖNDERİM — `approvedBy` boşsa 409. */
  @Post(":id/send")
  @HttpCode(200)
  send(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(sendOutboundSchema)) body: SendOutboundInput,
  ) {
    return this.outbound.send(user, id, body);
  }
}

/* ========================================================================== *
 * 4) Gelen mesaj
 * ========================================================================== */

@Controller("inbound-messages")
export class InboundMessagesController {
  constructor(private readonly inbound: InboundService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("matchStatus") matchStatus?: string,
    @Query("channel") channel?: string,
    @Query("clientId") clientId?: string,
    @Query("caseId") caseId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.inbound.list(user, { matchStatus, channel, clientId, caseId, page, limit });
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.inbound.detail(user, id);
  }

  /**
   * Gelen mesaj kaydı (webhook veya elle).
   *
   * Kredi kapısı KOŞULLUDUR ve `useAi` VARSAYILAN OLARAK KAPALIDIR: webhook
   * hattı sessizce kredi harcamaz. Deterministik eşleşme bulunduğunda AI hiç
   * çağrılmaz ve rezervasyon tamamen iade edilir.
   */
  @Post()
  @AiThrottle(1)
  @AiCredits("MESSAGE_CASE_MATCH", {
    when: (body) => (body as { useAi?: unknown } | undefined)?.useAi === true,
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createInboundSchema)) body: CreateInboundInput,
  ) {
    return this.inbound.create(user, body);
  }

  /** Avukatın açıkça istediği AI dosya önerisi (kredili). */
  @Post(":id/suggest-case")
  @AiThrottle(1)
  @AiCredits("MESSAGE_CASE_MATCH")
  @HttpCode(200)
  suggest(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(suggestInboundCaseSchema)) body: SuggestInboundCaseInput,
  ) {
    return this.inbound.suggestCase(user, id, body);
  }

  /** İNSAN KARARI — dosya bağlantısını kesinleştirir veya reddeder. */
  @Patch(":id/match")
  match(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(matchInboundSchema)) body: MatchInboundInput,
  ) {
    return this.inbound.confirmMatch(user, id, body);
  }
}
