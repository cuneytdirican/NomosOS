import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { HearingsService } from "./hearings.service";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import {
  createHearingSchema,
  hearingPrepSchema,
  hearingResultSchema,
  updateHearingSchema,
  type CreateHearingInput,
  type HearingPrepInput,
  type HearingResultInput,
  type UpdateHearingInput,
} from "./hearings.dto";

@Controller("hearings")
export class HearingsController {
  constructor(private readonly hearingsService: HearingsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("caseId") caseId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("attendeeUserId") attendeeUserId?: string
  ) {
    return this.hearingsService.list(user.tenantId, { from, to, caseId, status, page, limit, attendeeUserId }, user);
  }

  /** Faz 1: tarihi geçmiş, sonucu girilmemiş duruşmalar (":id" rotasından ÖNCE). */
  @Get("pending-results")
  pendingResults(@CurrentUser() user: AuthUser) {
    return this.hearingsService.pendingResults(user.tenantId, user);
  }

  /**
   * Faz 1: "Duruşmayı hazırla" — HEARING_PREP ajanı (9 bölümlü paket). Kredi
   * kapısı dosya bağlamını duruşma kaydı üzerinden ölçer (parentCaseId: HEARING).
   */
  @Post(":id/prep")
  @AiThrottle(3)
  @AiCredits("HEARING_PREP", { parentCaseId: { kind: "HEARING", param: "id" } })
  @HttpCode(200)
  prepare(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(hearingPrepSchema)) body: HearingPrepInput
  ) {
    return this.hearingsService.prepare(user, id, body);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createHearingSchema)) body: CreateHearingInput
  ) {
    return this.hearingsService.create(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.hearingsService.detail(user.tenantId, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateHearingSchema)) body: UpdateHearingInput
  ) {
    return this.hearingsService.update(user, id, body);
  }

  @Patch(":id/result")
  setResult(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(hearingResultSchema)) body: HearingResultInput
  ) {
    return this.hearingsService.setResult(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.hearingsService.remove(user, id);
  }
}
