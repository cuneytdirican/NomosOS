import { Body, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import {
  PlatformSupportTicketsService,
  platformTicketReplySchema,
  platformTicketUpdateSchema,
  type PlatformTicketReplyInput,
  type PlatformTicketUpdateInput,
} from "./platform-support-tickets.service";

/** FAZ 8C — /api/admin/v1/support-tickets: destek kuyruğu + SLA sayacı. */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/support-tickets`)
export class PlatformSupportTicketsController {
  constructor(private readonly tickets: PlatformSupportTicketsService) {}

  @Get()
  @ReadPermission("support.tickets.view")
  list(@Query("status") status?: string, @Query("tenantId") tenantId?: string) {
    return this.tickets.list({ status, tenantId });
  }

  @Get(":id")
  @ReadPermission("support.tickets.view")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.tickets.detail(id);
  }

  @Post(":id/messages")
  @HttpCode(200)
  @WritePermission("support.tickets.update")
  reply(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(platformTicketReplySchema)) body: PlatformTicketReplyInput) {
    return this.tickets.reply(user, id, body);
  }

  @Patch(":id")
  @WritePermission("support.tickets.update")
  update(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(platformTicketUpdateSchema)) body: PlatformTicketUpdateInput) {
    return this.tickets.update(user, id, body);
  }
}
