import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformPaymentsService } from "./platform-payments.service";
import { refundRequestSchema, type RefundRequestInput } from "./platform-payments.schemas";

/** `/api/admin/v1/payments` */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/payments`)
export class PlatformPaymentsController {
  constructor(private readonly payments: PlatformPaymentsService) {}

  /** DİKKAT: `/failed` rotası `:id` içeren rotalardan ÖNCE tanımlanmalıdır. */
  @Get("failed")
  @ReadPermission("payment.view")
  failed(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Query() query: { page?: string; limit?: string }
  ) {
    return this.payments.failed(user, query);
  }

  @Get()
  @ReadPermission("payment.view")
  list(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Query()
    query: {
      status?: string;
      tenantId?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    }
  ) {
    return this.payments.list(user, query);
  }

  /** DÖRT-GÖZ: iadeyi açan kişi onaylayamaz (spec kabul kriteri 5). */
  @Post(":id/refund")
  @HttpCode(202)
  @WritePermission("payment.refund")
  refund(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(refundRequestSchema)) body: RefundRequestInput
  ) {
    return this.payments.requestRefund(user, id, body);
  }
}

/** `/api/admin/v1/invoices` — PLATFORM faturaları (büronun müvekkil faturası DEĞİL). */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/invoices`)
export class PlatformInvoicesController {
  constructor(private readonly payments: PlatformPaymentsService) {}

  @Get()
  @ReadPermission("invoice.view")
  list(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Query() query: { tenantId?: string; status?: string; page?: string; limit?: string }
  ) {
    return this.payments.invoices(user, query);
  }

  @Post(":id/issue")
  @HttpCode(200)
  @WritePermission("invoice.issue")
  issue(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.payments.issueInvoice(user, id);
  }
}
