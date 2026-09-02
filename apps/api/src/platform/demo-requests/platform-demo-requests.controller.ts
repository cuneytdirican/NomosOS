import { Body, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import { z } from "zod";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { DEMO_REQUEST_STATUSES, PlatformDemoRequestsService } from "./platform-demo-requests.service";

/**
 * Demo talepleri — platform paneli (kullanıcı kararı: kayıt burada izlenir,
 * e-posta gönderilmez).
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/demo-requests`)
export class PlatformDemoRequestsController {
  constructor(private readonly demoRequests: PlatformDemoRequestsService) {}

  @Get()
  @ReadPermission("demoRequests.view")
  list(
    @CurrentPlatformUser() _user: PlatformAuthUser,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.demoRequests.list({ status, page, limit });
  }

  @Patch(":id")
  @WritePermission("demoRequests.update")
  updateStatus(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(DEMO_REQUEST_STATUSES) })))
    body: { status: (typeof DEMO_REQUEST_STATUSES)[number] },
  ) {
    return this.demoRequests.updateStatus(user, id, body.status);
  }
}
