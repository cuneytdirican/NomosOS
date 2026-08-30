import { Module } from "@nestjs/common";
import { DeadlineRulesModule } from "../deadline-rules/deadline-rules.module";
import { StorageModule } from "../storage/storage.module";
import { AgentRunnerService } from "./agent-runner.service";
import { DeadlineComputeService } from "./deadline-compute.service";
import { PipelineService } from "./pipeline.service";

/**
 * Belge → Aksiyon hattı modülü.
 *
 * Kendi HTTP ucu yoktur: hat, belge yüklendiğinde DocumentsService tarafından
 * tetiklenir; koşum kayıtları belge uçlarından okunur.
 * `DeadlineComputeService` onay kuyruğunda da kullanıldığı için dışa aktarılır.
 */
@Module({
  imports: [StorageModule, DeadlineRulesModule],
  providers: [PipelineService, AgentRunnerService, DeadlineComputeService],
  exports: [PipelineService, AgentRunnerService, DeadlineComputeService],
})
export class PipelineModule {}
