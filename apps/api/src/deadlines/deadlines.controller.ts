import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { DeadlinesService } from "./deadlines.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import {
  computeDeadlineSchema,
  correctDeadlineInputsSchema,
  createDeadlineSchema,
  deadlineFromRuleSchema,
  updateDeadlineSchema,
  updateDeadlineStatusSchema,
  type ComputeDeadlineInput,
  type CorrectDeadlineInputsInput,
  type CreateDeadlineInput,
  type DeadlineFromRuleInput,
  type UpdateDeadlineInput,
  type UpdateDeadlineStatusInput,
} from "./deadlines.dto";

@Controller("deadlines")
export class DeadlinesController {
  constructor(private readonly deadlinesService: DeadlinesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("caseId") caseId?: string,
    @Query("ownerId") ownerId?: string,
    @Query("source") source?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("days") days?: string,
    @Query("open") open?: string,
    @Query("overdue") overdue?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.deadlinesService.list(user.tenantId, {
      status,
      caseId,
      ownerId,
      source,
      from,
      to,
      days,
      open,
      overdue,
      q,
      page,
      limit,
    }, user);
  }

  @Get("upcoming")
  upcoming(@CurrentUser() user: AuthUser, @Query("days") days?: string) {
    return this.deadlinesService.upcoming(user.tenantId, days);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDeadlineSchema)) body: CreateDeadlineInput
  ) {
    return this.deadlinesService.create(user, body);
  }

  /** Süre motorunu çalıştırır; kayıt oluşturmaz. */
  @Post("compute")
  @HttpCode(200)
  compute(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(computeDeadlineSchema)) body: ComputeDeadlineInput
  ) {
    return this.deadlinesService.compute(user, body);
  }

  /** Süre motorunu çalıştırır ve ONAYLANDI durumunda Deadline kaydı açar. */
  @Post("from-rule")
  createFromRule(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(deadlineFromRuleSchema)) body: DeadlineFromRuleInput
  ) {
    return this.deadlinesService.createFromRule(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.deadlinesService.detail(user.tenantId, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDeadlineSchema)) body: UpdateDeadlineInput
  ) {
    return this.deadlinesService.update(user, id, body);
  }

  /**
   * Kural motorundan üretilmiş sürenin GİRDİSİNİ düzeltir; motor yeniden
   * koşar ve son günü kendisi yazar (denetim bulgusu K-14).
   *
   * `PATCH /deadlines/:id` son günü elle değiştirmeyi reddeder ve bu ucu
   * gösterir. Rota sırası önemlidir: `:id/inputs`, `:id`den sonra tanımlansa
   * bile Nest daha spesifik yolu doğru eşler; yine de okunurluk için status
   * ucunun yanında durur.
   */
  @Patch(":id/inputs")
  correctInputs(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(correctDeadlineInputsSchema)) body: CorrectDeadlineInputsInput
  ) {
    return this.deadlinesService.correctInputs(user, id, body);
  }

  @Patch(":id/status")
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDeadlineStatusSchema)) body: UpdateDeadlineStatusInput
  ) {
    return this.deadlinesService.updateStatus(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.deadlinesService.remove(user, id);
  }
}
