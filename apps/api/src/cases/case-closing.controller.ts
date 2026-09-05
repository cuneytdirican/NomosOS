import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { CaseClosingService, closingChecklistSchema, type ClosingChecklistInput } from "./case-closing.service";

/** FAZ 7G — /cases/:caseId/closing-checklist (ayrı controller; cases.controller'a dokunulmaz). */
@Controller("cases")
export class CaseClosingController {
  constructor(private readonly closing: CaseClosingService) {}

  @Get(":caseId/closing-checklist")
  checklist(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.closing.checklist(user, caseId);
  }

  @Put(":caseId/closing-checklist")
  save(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string, @Body(new ZodValidationPipe(closingChecklistSchema)) body: ClosingChecklistInput) {
    return this.closing.save(user, caseId, body);
  }
}
