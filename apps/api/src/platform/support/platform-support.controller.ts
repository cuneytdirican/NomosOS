import { Delete, Get, Param, Query } from "@nestjs/common";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformSupportService } from "./platform-support.service";

/**
 * `/api/admin/v1/support-access`
 *
 * Pencere AÇMA ucu burada değildir: `POST /tenants/:id/support-access`
 * (dört-göz talebi) üzerinden yürür. Burada listeleme ve erken iptal vardır.
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/support-access`)
export class PlatformSupportController {
  constructor(private readonly support: PlatformSupportService) {}

  @Get()
  @ReadPermission("support_grant.view")
  list(
    @Query() query: { tenantId?: string; activeOnly?: string; page?: string; limit?: string }
  ) {
    return this.support.list(query);
  }

  @Delete(":id")
  @WritePermission("support_grant.revoke")
  revoke(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.support.revoke(user, id);
  }
}
