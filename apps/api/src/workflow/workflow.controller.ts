import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { WorkflowService } from "./workflow.service";
import { applyWorkflowSchema, workflowTemplateSchema, type ApplyWorkflowInput, type WorkflowTemplateInput } from "./workflow-templates";

/** FAZ 7C — /workflow-templates: sistem + büro şablonları; :key/apply dosyaya görev zinciri. */
@Controller("workflow-templates")
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("caseType") caseType?: string) {
    return this.workflow.list(user, caseType);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(workflowTemplateSchema)) body: WorkflowTemplateInput) {
    return this.workflow.create(user, body);
  }

  @Patch(":id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(workflowTemplateSchema.partial())) body: Partial<WorkflowTemplateInput>) {
    return this.workflow.update(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workflow.remove(user, id);
  }

  @Post(":key/apply")
  @HttpCode(200)
  apply(@CurrentUser() user: AuthUser, @Param("key") key: string, @Body(new ZodValidationPipe(applyWorkflowSchema)) body: ApplyWorkflowInput) {
    return this.workflow.apply(user, key, body);
  }
}
