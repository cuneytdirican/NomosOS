import { Controller, Get, Query } from "@nestjs/common";

/**
 * F2 · E1 — AJAN İZ GÖRÜNÜMÜ UCI.
 *
 * Kimlik: JwtAuthGuard APP_GUARD ile küreseldir (app.module.ts); bu uç kiracı
 * evrenindedir ve tenant süzgeci serviste uygulanır. Yalnızca OKUMADIR —
 * izler sistem tarafından yazılır, uçtan yazım yoktur.
 */

import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { AgentRunService } from "./agent-run.service";

@Controller("ai")
export class AgentRunsController {
  constructor(private readonly agentRuns: AgentRunService) {}

  /** GET /ai/agent-runs — kiracının ajan iz görünümü (en yeni önce). */
  @Get("agent-runs")
  list(
    @CurrentUser() user: AuthUser,
    @Query("agentKey") agentKey?: string,
    @Query("taskType") taskType?: string,
    @Query("status") status?: string,
    @Query("take") take?: string,
  ) {
    const takeNum = Number.parseInt(take ?? "", 10);
    return this.agentRuns.list(user.tenantId, {
      agentKey: agentKey || undefined,
      taskType: taskType || undefined,
      status: status || undefined,
      take: Number.isFinite(takeNum) ? takeNum : undefined,
    });
  }
}
