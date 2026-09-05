import { Module } from "@nestjs/common";
import { AiTrainingController, PlatformAiTrainingController } from "./ai-training.controller";
import { AiTrainingDataService } from "./ai-training.service";
import { TenantFineTuneController } from "./tenant-fine-tune.controller";
import { TenantFineTuneService } from "./tenant-fine-tune.service";
import { PlatformModule } from "../platform/platform.module";
// Kullanıcı tanımlı model eğitimi: BYO lisans kapısı (allowBYOLLM) AiModule'deki
// PlatformAiService'tendir; kiracı eğitim işleri aynı kapıdan geçer.
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [PlatformModule, AiModule],
  controllers: [AiTrainingController, PlatformAiTrainingController, TenantFineTuneController],
  providers: [AiTrainingDataService, TenantFineTuneService],
  exports: [AiTrainingDataService],
})
export class AiTrainingModule {}
