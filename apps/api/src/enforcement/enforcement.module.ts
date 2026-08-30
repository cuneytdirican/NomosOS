import { Module } from "@nestjs/common";
import { CaselawModule } from "../caselaw/caselaw.module";
import { DeadlineRulesModule } from "../deadline-rules/deadline-rules.module";
import { EnforcementBalanceService } from "./balance.service";
import { CollectionScoreService } from "./collection-score.service";
import { EnforcementCopilotService } from "./copilot.service";
import { EnforcementDeadlinesService } from "./enforcement-deadlines.service";
import {
  AssetsController,
  EnforcementActionsController,
  EnforcementController,
} from "./enforcement.controller";
import { EnforcementService } from "./enforcement.service";

/**
 * İcra Modülü (Modül 05).
 *
 * BAĞIMLILIKLAR:
 *  - `CaselawModule` → ortak BYO-LLM koşu yürütücüsü `AiRunnerService`
 *    (KVKK kapısı + output-guard + AiUsageLog). Bağımlılık tek yönlüdür;
 *    içtihat katmanı icradan hiçbir şey bilmez.
 *  - `DeadlineRulesModule` → İİK süre kurallarının kiracı bazlı çözümü.
 *  - `PrismaModule` / `AuditModule` @Global olduğu için ayrıca import edilmez.
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir; bu modül orada
 * `CaselawModule`'den SONRA import edilmelidir.
 */
@Module({
  imports: [CaselawModule, DeadlineRulesModule],
  controllers: [EnforcementController, EnforcementActionsController, AssetsController],
  providers: [
    EnforcementService,
    EnforcementBalanceService,
    CollectionScoreService,
    EnforcementDeadlinesService,
    EnforcementCopilotService,
  ],
  exports: [EnforcementService, EnforcementBalanceService, CollectionScoreService],
})
export class EnforcementModule {}
