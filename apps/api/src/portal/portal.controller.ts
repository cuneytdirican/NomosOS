import { Body, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentPortalUser } from "./decorators/current-portal-user.decorator";
import { PortalAudit } from "./decorators/portal-audit.decorator";
import { PortalController as PortalControllerDecorator } from "./decorators/portal-controller.decorator";
import { PortalRateLimit } from "./guards/portal-rate-limit.guard";
import { PortalService } from "./portal.service";
import { portalMessageSchema, type PortalMessageInput } from "./portal.schemas";
import type { PortalAuthUser } from "./portal.types";
import { RandevuService } from "../randevu/randevu.service";

/**
 * MÜVEKKİL PORTALI — `/api/v1/portal/**`
 *
 * Her uç `@PortalController` zincirinden geçer:
 *   büro guard'ı atlanır → PortalJwtGuard → hız sınırı → denetim kaydı.
 *
 * Hiçbir uç kimlik dışı bir parametreyle KAPSAM GENİŞLETEMEZ: `clientId`
 * istemciden ASLA alınmaz, her zaman oturumdan gelir. Bu yüzden burada
 * `?clientId=` gibi bir süzgeç YOKTUR ve olmamalıdır.
 *
 * `:id` parametreleri `ParseUUIDPipe` ile doğrulanır: biçimsiz bir id,
 * veritabanına hiç gitmeden 400 alır (sorgu yüzeyini daraltır).
 */
@PortalControllerDecorator("portal")
export class PortalDataController {
  constructor(
    private readonly portal: PortalService,
    private readonly randevu: RandevuService
  ) {}

  /** Özet ekran: yayınlanmış dosya sayısı, yaklaşan duruşmalar, bakiye, mesajlar. */
  @PortalAudit("PORTAL_DASHBOARD_VIEW")
  @Get("dashboard")
  dashboard(@CurrentPortalUser() user: PortalAuthUser) {
    return this.portal.dashboard(user);
  }

  @PortalAudit("PORTAL_CASE_LIST", "Case")
  @Get("cases")
  listCases(@CurrentPortalUser() user: PortalAuthUser) {
    return this.portal.listCases(user);
  }

  @PortalAudit("PORTAL_CASE_VIEW", "Case")
  @Get("cases/:id")
  caseDetail(
    @CurrentPortalUser() user: PortalAuthUser,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.portal.caseDetail(user, id);
  }

  /** Yayınlanmış belgeler. `caseId` verilirse o dosya da yayında olmalıdır. */
  @PortalAudit("PORTAL_DOCUMENT_LIST", "Document")
  @Get("documents")
  listDocuments(
    @CurrentPortalUser() user: PortalAuthUser,
    @Query("caseId") caseId?: string
  ) {
    return this.portal.listDocuments(user, caseId);
  }

  /** Kısa ömürlü ön-imzalı indirme bağlantısı (120 sn). */
  @PortalAudit("PORTAL_DOCUMENT_DOWNLOAD", "Document")
  @Get("documents/:id/download")
  download(@CurrentPortalUser() user: PortalAuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.portal.downloadDocument(user, id);
  }

  @PortalAudit("PORTAL_HEARING_LIST", "Hearing")
  @Get("hearings")
  listHearings(
    @CurrentPortalUser() user: PortalAuthUser,
    @Query("caseId") caseId?: string
  ) {
    return this.portal.listHearings(user, caseId);
  }

  @PortalAudit("PORTAL_TIMELINE_VIEW", "TimelineEvent")
  @Get("timeline")
  timeline(@CurrentPortalUser() user: PortalAuthUser, @Query("caseId") caseId?: string) {
    return this.portal.timeline(user, caseId);
  }

  @PortalAudit("PORTAL_INVOICE_LIST", "Invoice")
  @Get("invoices")
  listInvoices(@CurrentPortalUser() user: PortalAuthUser) {
    return this.portal.listInvoices(user);
  }

  @PortalAudit("PORTAL_PAYMENT_LIST", "Payment")
  @Get("payments")
  listPayments(@CurrentPortalUser() user: PortalAuthUser) {
    return this.portal.listPayments(user);
  }

  @PortalAudit("PORTAL_MESSAGE_LIST", "Message")
  @Get("messages")
  listMessages(@CurrentPortalUser() user: PortalAuthUser) {
    return this.portal.listMessages(user);
  }

  /**
   * Müvekkil mesaj yazar. Her istek büro tarafında bir kuyruk satırı doğurduğu
   * için ayrı bir hız sınırı kovasına bağlıdır (dakikada 10).
   */
  @PortalAudit("PORTAL_MESSAGE_SENT", "InboundMessage")
  @PortalRateLimit({ limit: 10, windowMs: 60_000, bucket: "portal-message" })
  @Post("messages")
  @HttpCode(201)
  createMessage(
    @CurrentPortalUser() user: PortalAuthUser,
    @Body(new ZodValidationPipe(portalMessageSchema)) body: PortalMessageInput
  ) {
    return this.portal.createMessage(user, body);
  }

  /* ---------------- E9 (rakip analizi) — portal randevu self-servisi ---------------- */

  /** Müvekkilin yaklaşan planlanmış randevuları. */
  @PortalAudit("PORTAL_RANDEVU_LISTE")
  @Get("randevular")
  randevularim(@CurrentPortalUser() user: PortalAuthUser) {
    return this.randevu.portalList(user);
  }

  /** Müvekkil randevu alır — süre sabit 30 dk, çakışma kapısı serviste. */
  @PortalAudit("PORTAL_RANDEVU_AL", "Randevu")
  @PortalRateLimit({ limit: 5, windowMs: 60_000, bucket: "portal-randevu" })
  @Post("randevular")
  @HttpCode(201)
  randevuAl(
    @CurrentPortalUser() user: PortalAuthUser,
    @Body(
      new ZodValidationPipe(
        z.object({
          title: z.string().trim().min(3, "Randevu konusu zorunludur.").max(200),
          startAt: z.coerce.date({ invalid_type_error: "Başlangıç geçerli bir tarih olmalıdır." }),
        })
      )
    )
    body: { title: string; startAt: Date }
  ) {
    return this.randevu.portalCreate(user, body);
  }

  /** Müvekkil kendi planlanmış randevusunu iptal eder. */
  @PortalAudit("PORTAL_RANDEVU_IPTAL", "Randevu")
  @Post("randevular/:id/iptal")
  @HttpCode(200)
  randevuIptal(
    @CurrentPortalUser() user: PortalAuthUser,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.randevu.portalCancel(user, id);
  }

  /** Sorumlu avukat kartı — yalnızca iş iletişimi bilgileri. */
  @PortalAudit("PORTAL_LAWYER_VIEW", "User")
  @Get("lawyer")
  lawyer(@CurrentPortalUser() user: PortalAuthUser) {    return this.portal.lawyer(user);
  }
}
