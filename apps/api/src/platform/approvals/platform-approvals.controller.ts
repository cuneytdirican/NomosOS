import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformApprovalsService } from "./platform-approvals.service";

const decisionSchema = z.object({
  note: z
    .string()
    .trim()
    .max(1000, "Karar notu en fazla 1000 karakter olabilir.")
    .optional(),
});
type DecisionInput = z.infer<typeof decisionSchema>;

/**
 * ONAY KUYRUĞU UÇLARI.
 *
 * GENEL BİR "talep oluştur" UCU BİLİNÇLİ OLARAK YOKTUR: talepler yalnızca
 * ilgili domain ucundan (tenant askıya alma, iade, plan değişikliği…) doğar.
 * Serbest bir POST /approvals, istemcinin `action` ve `payloadJson` alanlarını
 * kendi belirlemesi demek olurdu; onaylayan taraf ekranda gördüğü özete
 * güvenerek, aslında hiç geçilmemiş bir yetki kapısının arkasındaki işlemi
 * uygulamış olurdu.
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/approvals`)
export class PlatformApprovalsController {
  constructor(private readonly approvals: PlatformApprovalsService) {}

  @Get()
  @ReadPermission("approval.view")
  list(@Query() query: { status?: string; tenantId?: string; page?: string; limit?: string }) {
    return this.approvals.list(query);
  }

  @Post(":id/approve")
  @HttpCode(200)
  @WritePermission("approval.decide")
  approve(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decisionSchema)) body: DecisionInput,
    @CurrentPlatformUser() user: PlatformAuthUser
  ) {
    return this.approvals.decide(id, user, "approve", body.note);
  }

  @Post(":id/reject")
  @HttpCode(200)
  @WritePermission("approval.decide")
  reject(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decisionSchema)) body: DecisionInput,
    @CurrentPlatformUser() user: PlatformAuthUser
  ) {
    return this.approvals.decide(id, user, "reject", body.note);
  }
}
