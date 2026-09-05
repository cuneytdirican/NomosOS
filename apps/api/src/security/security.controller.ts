/**
 * `/security/*` — büro güvenlik politikası + denetim izi (Enterprise++).
 *
 *   GET   /security/policy           — politika + 2FA yaygınlığı (ADMIN/PARTNER okur)
 *   PATCH /security/policy           — { require2fa?, sessionMaxHours? } (yalnız ADMIN)
 *   GET   /security/audit            — büronun denetim izi (süzgeçli, sayfalı)
 *   GET   /security/audit/actions    — süzgeç için işlem adları
 *   GET   /security/audit/export.csv — CSV (formül enjeksiyonu korumalı; olay denetim izine düşer)
 */

import { Body, Controller, Get, Header, Patch, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { SecurityService, type AuditQuery } from "./security.service";

const policySchema = z
  .object({
    require2fa: z.boolean().optional(),
    sessionMaxHours: z.number().int().min(1).max(24).nullable().optional(),
    retentionYears: z.number().int().min(10).max(30).optional(),
  })
  .refine((v) => v.require2fa !== undefined || v.sessionMaxHours !== undefined || v.retentionYears !== undefined, {
    message: "Güncellenecek bir alan gönderin (require2fa, sessionMaxHours, retentionYears).",
  });
type PolicyInput = z.infer<typeof policySchema>;

@Controller("security")
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get("policy")
  policy(@CurrentUser() user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "büro güvenlik politikasını görüntüleme");
    return this.security.getPolicy(user);
  }

  @Patch("policy")
  updatePolicy(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(policySchema)) body: PolicyInput) {
    return this.security.updatePolicy(user, body);
  }

  @Get("audit")
  audit(@CurrentUser() user: AuthUser, @Query() query: AuditQuery) {
    return this.security.listAudit(user, query);
  }

  @Get("audit/actions")
  auditActions(@CurrentUser() user: AuthUser) {
    return this.security.auditActions(user);
  }

  @Get("audit/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async auditExport(@CurrentUser() user: AuthUser, @Query() query: AuditQuery, @Res() res: Response) {
    const { csv, rowCount, truncated } = await this.security.exportAuditCsv(user, query);
    res.setHeader("Content-Disposition", `attachment; filename="denetim-izi-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader("X-Row-Count", String(rowCount));
    res.setHeader("X-Truncated", truncated ? "1" : "0");
    res.send(csv);
  }
}
