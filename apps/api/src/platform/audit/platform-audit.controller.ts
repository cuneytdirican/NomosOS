import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import {
  ApprovalWritePermission,
  ReadPermission,
} from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import { reasonField } from "../tenants/platform-tenants.schemas";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformAuditQueryService } from "./platform-audit-query.service";

/**
 * DIŞA AKTARIM TALEBİ ŞEMASI — denetim bulgusu Ö-28.
 * Gerekçe zorunludur; dört-göz kuyruğundaki her talep gibi denetim izine yazılır.
 */
const auditExportSchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  tenantId: z.string().trim().uuid().optional(),
  action: z.string().trim().max(100).optional(),
  reason: reasonField,
});
type AuditExportInput = z.infer<typeof auditExportSchema>;

/** `/api/admin/v1/audit` — PlatformAuditLog arama/filtre ve dışa aktarım. */
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

  /**
   * DÖRT-GÖZ: denetim izi dışa aktarım TALEBİ (spec madde 8, bulgu Ö-28).
   * 202 döner — talep açıldı, dosya HENÜZ üretilmedi.
   */
  @Post("export")
  @HttpCode(202)
  @ApprovalWritePermission("audit.export")
  requestExport(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(auditExportSchema)) body: AuditExportInput
  ) {
    return this.auditQuery.requestExport(user, body);
  }

  /** Onaylanmış dışa aktarımın TEK SEFERLİK indirilmesi. */
  @Get("export/:approvalId")
  @ReadPermission("audit.export")
  download(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("approvalId") approvalId: string
  ) {
    return this.auditQuery.downloadExport(user, approvalId);
  }
}
