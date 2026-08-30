import { Module } from "@nestjs/common";
import { DeadlineRulesController } from "./deadline-rules.controller";
import { DeadlineRulesService } from "./deadline-rules.service";

@Module({
  controllers: [DeadlineRulesController],
  providers: [DeadlineRulesService],
  exports: [DeadlineRulesService],
})
export class DeadlineRulesModule {}
