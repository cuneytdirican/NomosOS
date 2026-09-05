/**
 * KİRACI TARAFI — abonelik, platform faturaları, ödeme (Faz 3).
 *
 *   GET  /subscription                       özet (plan, dönem, sonraki fatura, modüller)
 *   GET  /subscription/invoices              platform faturaları
 *   POST /subscription/invoices/:id/pay      ödeme başlat (SIMULASYON anında / iyzico sayfası)
 *   GET  /subscription/invoices/:id/pdf      fatura PDF
 *   PUT  /subscription/coupon {code}         kupon bağla   · DELETE kaldır
 *   PUT  /subscription/interval {AYLIK|YILLIK}
 *   POST /credits/purchase {packageKey, couponCode?}   (Faz 3: ödeme kesinleşince yükler)
 *   POST /billing/odeme/callback  (@Public, sağlayıcı form POST → yönlendirme)
 *   POST /billing/odeme/webhook   (@Public, imzalı bildirim)
 *
 * Yazma uçları `TenantStatusGuard` 402'sinden MUAFTIR (`/api/v1/billing`, `/api/v1/credits`
 * önekleri) — ödeme yolu asla kapanmaz; `/subscription` da aşağıdaki listeye eklendi.
 */

import { Body, Controller, Delete, Get, Headers, HttpCode, Ip, Param, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CouponService } from "./coupon.service";
import { PlatformCheckoutService } from "./platform-checkout.service";
import { SubscriptionInvoiceService, invoiceRecordDto } from "./subscription-invoice.service";
import { renderPlatformInvoicePdf } from "../billing/pdf/invoice-pdf";

const purchaseSchema = z.object({
  packageKey: z.string().min(2).max(64),
  couponCode: z.string().trim().max(32).nullable().optional(),
});
const couponSchema = z.object({ code: z.string().trim().min(3).max(32) });
const intervalSchema = z.object({ billingInterval: z.enum(["AYLIK", "YILLIK"]) });

@Controller()
export class SubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly coupons: CouponService,
    private readonly checkout: PlatformCheckoutService,
    private readonly invoices: SubscriptionInvoiceService,
  ) {}

  @Get("subscription")
  summary(@CurrentUser() user: AuthUser) {
    return this.invoices.tenantSummary(user.tenantId);
  }

  @Get("subscription/invoices")
  list(@CurrentUser() user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "platform faturalarını görüntüleme");
    return this.invoices.listForTenant(user.tenantId);
  }

  @Post("subscription/invoices/:id/pay")
  @HttpCode(200)
  pay(@CurrentUser() user: AuthUser, @Param("id") id: string, @Ip() ip: string) {
    return this.checkout.startInvoicePayment(user, id, ip);
  }

  @Get("subscription/invoices/:id/pdf")
  async pdf(@CurrentUser() user: AuthUser, @Param("id") id: string, @Res() res: Response) {
    assertRole(user, ROLE_SETS.ONAY, "platform faturası PDF");
    const invoice = await this.invoices.requireTenantInvoice(user.tenantId, id);
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true, address: true, taxNumber: true, taxOffice: true } });
    const buffer = await renderPlatformInvoicePdf({ invoice: invoiceRecordDto(invoice), tenant: tenant ?? { name: "Büro", address: null, taxNumber: null, taxOffice: null } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${(invoice.number ?? invoice.id).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`);
    res.send(buffer);
  }

  @Put("subscription/coupon")
  async setCoupon(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(couponSchema)) body: { code: string }) {
    assertRole(user, ROLE_SETS.ONAY, "kupon tanımlama");
    const coupon = await this.coupons.requireValid(body.code, "ABONELIK");
    await this.prisma.client.subscription.update({ where: { tenantId: user.tenantId }, data: { couponCode: coupon.code } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "ABONELIK_KUPON", entity: "Subscription", detail: `Kupon bağlandı: ${coupon.code}` });
    return { ok: true, couponCode: coupon.code, mesaj: "Kupon aboneliğe bağlandı; sonraki dönem faturasına uygulanır." };
  }

  @Delete("subscription/coupon")
  async clearCoupon(@CurrentUser() user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "kupon kaldırma");
    await this.prisma.client.subscription.update({ where: { tenantId: user.tenantId }, data: { couponCode: null } });
    return { ok: true };
  }

  @Put("subscription/interval")
  async setInterval(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(intervalSchema)) body: { billingInterval: "AYLIK" | "YILLIK" }) {
    assertRole(user, ROLE_SETS.ONAY, "faturalama aralığı");
    await this.prisma.client.subscription.update({ where: { tenantId: user.tenantId }, data: { billingInterval: body.billingInterval } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "ABONELIK_ARALIK", entity: "Subscription", detail: `Faturalama aralığı: ${body.billingInterval}` });
    return { ok: true, billingInterval: body.billingInterval, mesaj: "Sonraki dönem faturası bu aralıkla kesilecek." };
  }

  /** Faz 3: ek paket satın alma → ödeme kesinleşince kredi yüklenir. */
  @Post("credits/purchase")
  @HttpCode(200)
  purchase(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(purchaseSchema)) body: z.infer<typeof purchaseSchema>, @Ip() ip: string) {
    return this.checkout.startCreditPurchase(user, body.packageKey, body.couponCode ?? null, ip);
  }

  /** Sağlayıcı (iyzico) ödeme sonrası tarayıcıyı buraya POST'lar (`token`). */
  @Public()
  @Post("billing/odeme/callback")
  async callback(@Req() req: Request, @Res() res: Response) {
    const token = typeof (req.body as { token?: unknown })?.token === "string" ? (req.body as { token: string }).token : "";
    if (!token) return res.status(400).send("token eksik");
    const out = await this.checkout.completeProviderCheckout(token);
    return res.redirect(out.redirectUrl);
  }

  @Public()
  @Post("billing/odeme/webhook")
  @HttpCode(200)
  webhook(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: Record<string, unknown>) {
    return this.checkout.handleWebhook(headers, body ?? {});
  }
}
