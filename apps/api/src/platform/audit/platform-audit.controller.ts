import { Get, Query } from "@nestjs/common";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformAuditQueryService } from "./platform-audit-query.service";

/** `/api/admin/v1/audit` — PlatformAuditLog arama/filtre. */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/audit`)
export class PlatformAuditController {
  constructor(private readonly auditQuery: PlatformAuditQueryService) {}

  @Get()
  @ReadPermission("audit.view")
  list(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Query()
    query: {
      platformUserId?: string;
      tenantId?: string;
      action?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    }
  ) {
    return this.auditQuery.list(user, query);
  }
}
