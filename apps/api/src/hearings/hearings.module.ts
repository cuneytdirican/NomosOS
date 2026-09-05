import { Module } from "@nestjs/common";
import { HearingsController } from "./hearings.controller";
import { HearingsService } from "./hearings.service";
import { AssistantModule } from "../assistant/assistant.module";

/** AssistantModule: HEARING_PREP koşusu (LLM + dosya bağlamı + RAG). */
@Module({
  imports: [AssistantModule],
  controllers: [HearingsController],
  providers: [HearingsService],
})
export class HearingsModule {}
