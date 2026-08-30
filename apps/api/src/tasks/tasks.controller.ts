import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { createTaskSchema, type CreateTaskInput } from "@nomosos/shared";
import { TasksService } from "./tasks.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import {
  updateTaskSchema,
  updateTaskStatusSchema,
  type UpdateTaskInput,
  type UpdateTaskStatusInput,
} from "./tasks.dto";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("assigneeId") assigneeId?: string,
    @Query("reviewerId") reviewerId?: string,
    @Query("caseId") caseId?: string,
    @Query("priority") priority?: string,
    @Query("overdue") overdue?: string,
    @Query("open") open?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.tasksService.list(user.tenantId, {
      status,
      assigneeId,
      reviewerId,
      caseId,
      priority,
      overdue,
      open,
      from,
      to,
      page,
      limit,
    });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput) {
    return this.tasksService.create(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.tasksService.detail(user.tenantId, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput
  ) {
    return this.tasksService.update(user, id, body);
  }

  @Patch(":id/status")
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTaskStatusSchema)) body: UpdateTaskStatusInput
  ) {
    return this.tasksService.updateStatus(user, id, body.status, body.note);
  }
}
