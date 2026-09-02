import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { PlatformAiService } from "./platform-ai.service";
import { PlatformAiProviderController } from "./platform-ai-provider.controller";
import { PlatformModule } from "../platform/platform.module";

@Module({
  imports: [PlatformModule],
  controllers: [AiController, PlatformAiProviderController],
  providers: [AiService, PlatformAiService],
  exports: [AiService, PlatformAiService],
})
export class AiModule {}
