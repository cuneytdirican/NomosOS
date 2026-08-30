import { Module } from "@nestjs/common";
import { CaselawModule } from "../caselaw/caselaw.module";
import { DeadlineRulesModule } from "../deadline-rules/deadline-rules.module";
import { ExpertDeadlinesService } from "./expert-deadlines.service";
import { ExpertDiffService } from "./expert-diff.service";
import {
  CaseExpertReportsController,
  ExpertObjectionsController,
  ExpertReportsController,
  ExpertsController,
} from "./expert.controller";
import { ExpertService } from "./expert.service";

/**
 * Bilirkişi Yönetimi (Modül 13).
 *
 * BAĞIMLILIKLAR:
 *  - `CaselawModule`      → ortak BYO-LLM koşu yürütücüsü `AiRunnerService`
 *    (KVKK kapısı + output-guard + AiUsageLog).
 *  - `DeadlineRulesModule` → HMK m.281 itiraz süresinin kiracı bazlı çözümü.
 *  - `PrismaModule` / `AuditModule` @Global olduğu için ayrıca import edilmez.
 *
 * DİLEKÇE MODÜLÜNE BAĞIMLILIK YOKTUR: itiraz dilekçesi taslağı doğrudan Prisma
 * ile açılır (bkz. ExpertService.draftObjectionPetition). Bu bilinçlidir —
 * iki modül birbirine kenetlenmez.
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir; bu modül orada
 * `CaselawModule`'den SONRA import edilmelidir.
 */
@Module({
  imports: [CaselawModule, DeadlineRulesModule],
  controllers: [
    ExpertsController,
    CaseExpertReportsController,
    ExpertReportsController,
    ExpertObjectionsController,
  ],
  providers: [ExpertService, ExpertDeadlinesService, ExpertDiffService],
  exports: [ExpertService, ExpertDeadlinesService],
})
export class ExpertModule {}
