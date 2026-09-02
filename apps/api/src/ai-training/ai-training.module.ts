import { Module } from "@nestjs/common";
import { AiTrainingController, PlatformAiTrainingController } from "./ai-training.controller";
import { AiTrainingDataService } from "./ai-training.service";
import { PlatformModule } from "../platform/platform.module";

@Module({
  imports: [PlatformModule],
  controllers: [AiTrainingController, PlatformAiTrainingController],
  providers: [AiTrainingDataService],
  exports: [AiTrainingDataService],
})
export class AiTrainingModule {}
