import { Module } from "@nestjs/common";
import { DeadlineRulesModule } from "../deadline-rules/deadline-rules.module";
import { StorageModule } from "../storage/storage.module";
// D1.3: BYO yetkisi + platform sağlayıcı yedeği için.
import { AiModule } from "../ai/ai.module";
import { AgentRunnerService } from "./agent-runner.service";
import { DeadlineComputeService } from "./deadline-compute.service";
import { PipelineService } from "./pipeline.service";
import { PipelineQueueService } from "./pipeline-queue.service";

/**
 * Belge → Aksiyon hattı modülü.
 *
 * Kendi HTTP ucu yoktur: hat, belge yüklendiğinde DocumentsService tarafından
 * tetiklenir; koşum kayıtları belge uçlarından okunur.
 * `DeadlineComputeService` onay kuyruğunda da kullanıldığı için dışa aktarılır.
 *
 * F2 · B1: `PipelineQueueService` (BullMQ + DLQ) dışa açıktır — Redis kapalıysa
 * yumuşak düşüş DocumentsService'in senkron çağrısıdır; belge yükleme Redise
 * SERT bağımlı hâle gelmez.
 */
@Module({
  imports: [StorageModule, DeadlineRulesModule, AiModule],
  providers: [PipelineService, AgentRunnerService, DeadlineComputeService, PipelineQueueService],
  exports: [PipelineService, AgentRunnerService, DeadlineComputeService, PipelineQueueService],
})
export class PipelineModule {}
