import { Global, Module } from "@nestjs/common";

/**
 * F2 · E1 — AI AJAN GÖZLENEBİLİRLİK MODÜLÜ.
 *
 * AgentsModule @Global'dir (PrismaModule deseni): AiRunnerService (caselaw
 * alt katmanı) ve AssistantLlmService, iz kaydını yüzey modülü import etmeden
 * enjekte eder — ajan izi HER LLM yürütücüsünde varsayılan olarak açık
 * olmalıdır; yeni bir AI modülü izlemeyi "hatırlamak" zorunda kalmamalıdır.
 *
 * Kimlik: JwtAuthGuard APP_GUARD ile küreseldir; GET /ai/agent-runs kiracı
 * evrenindedir, tenant süzgeci AgentRunService.list içinde uygulanır.
 */

import { AgentRunsController } from "./agent-runs.controller";
import { AgentRunService } from "./agent-run.service";

@Global()
@Module({
  controllers: [AgentRunsController],
  providers: [AgentRunService],
  exports: [AgentRunService],
})
export class AgentsModule {}
