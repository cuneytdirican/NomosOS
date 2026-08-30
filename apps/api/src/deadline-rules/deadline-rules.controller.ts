import { Controller, Get, Query } from "@nestjs/common";
import { DeadlineRulesService } from "./deadline-rules.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

@Controller("deadline-rules")
export class DeadlineRulesController {
  constructor(private readonly deadlineRulesService: DeadlineRulesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("caseType") caseType?: string,
    @Query("q") q?: string,
    @Query("includeInactive") includeInactive?: string
  ) {
    return this.deadlineRulesService.list(user.tenantId, { caseType, q, includeInactive });
  }
}
