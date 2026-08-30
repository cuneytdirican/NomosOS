import { Controller, Get, Query } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Panelin tüm verisi tek çağrıda. scope=me → yalnız kullanıcının işleri. */
  @Get("summary")
  summary(@CurrentUser() user: AuthUser, @Query("scope") scope?: string) {
    return this.dashboardService.summary(user, scope);
  }
}
