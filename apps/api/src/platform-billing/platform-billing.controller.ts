/**
 * PLATFORM PANELİ — kuponlar, elle ödendi işaretleme, dönem faturası kesme (Faz 3).
 *
 *   GET/POST  /api/admin/v1/coupons · PATCH /coupons/:id
 *   POST      /api/admin/v1/invoices/:id/mark-paid   {method, reference, note}
 *   POST      /api/admin/v1/subscriptions/:id/issue-invoice   (sonraki dönem faturasını şimdi kes)
 */

import { Body, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PlatformController } from "../platform/decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../platform/decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../platform/decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform/platform.constants";
import type { PlatformAuthUser } from "../platform/platform.types";
import { PrismaService } from "../prisma/prisma.service";
import { CouponService, couponCreateSchema, couponPatchSchema, type CouponCreateInput, type CouponPatchInput } from "./coupon.service";
import { PlatformCheckoutService } from "./platform-checkout.service";
import { SubscriptionInvoiceService, invoiceRecordDto } from "./subscription-invoice.service";

const markPaidSchema = z.object({
  method: z.string().trim().min(2).max(40).default("HAVALE"),
  reference: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).nullable().optional(),
});

@PlatformController(`${ADMIN_ROUTE_PREFIX}/coupons`)
export class PlatformCouponsController {
  constructor(private readonly coupons: CouponService) {}

  @Get()
  @ReadPermission("coupon.view")
  list() {
    return this.coupons.list();
  }

  @Post()
  @WritePermission("coupon.manage")
  create(@CurrentPlatformUser() user: PlatformAuthUser, @Body(new ZodValidationPipe(couponCreateSchema)) body: CouponCreateInput) {
    return this.coupons.create(user, body);
  }

  @Patch(":id")
  @WritePermission("coupon.manage")
  patch(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(couponPatchSchema)) body: CouponPatchInput) {
    return this.coupons.patch(user, id, body);
  }
}

@PlatformController(`${ADMIN_ROUTE_PREFIX}/invoices`)
export class PlatformInvoiceSettlementController {
  constructor(private readonly checkout: PlatformCheckoutService) {}

  /** Havale/EFT ile ödenen faturayı kesinleştir (kredi yükle / dönemi ilerlet). */
  @Post(":id/mark-paid")
  @HttpCode(200)
  @WritePermission("invoice.issue")
  markPaid(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(markPaidSchema)) body: z.infer<typeof markPaidSchema>) {
    return this.checkout.markPaidManual(user, id, body);
  }
}

@PlatformController(`${ADMIN_ROUTE_PREFIX}/subscriptions`)
export class PlatformSubscriptionInvoiceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: SubscriptionInvoiceService,
  ) {}

  /** Sonraki dönem faturasını şimdi kes (iş beklemeden; idempotent). */
  @Post(":id/issue-invoice")
  @HttpCode(200)
  @WritePermission("invoice.issue")
  async issue(@Param("id") id: string) {
    const sub = await this.prisma.client.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException("Abonelik bulunamadı.");
    if (sub.status === "CANCELED") throw new BadRequestException("İptal edilmiş abonelik için fatura kesilmez.");
    const now = new Date();
    const periodStart = sub.currentPeriodEnd ?? now;
    const res = await this.invoices.issueForPeriod({ subscription: sub, periodStart, now });
    return { created: res.created, fatura: invoiceRecordDto(res.invoice) };
  }
}
