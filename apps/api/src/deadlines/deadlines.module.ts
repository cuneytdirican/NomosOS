import { Module } from "@nestjs/common";
import { DeadlinesController } from "./deadlines.controller";
import { DeadlinesService } from "./deadlines.service";
import { DeadlineRulesModule } from "../deadline-rules/deadline-rules.module";

@Module({
  imports: [DeadlineRulesModule],
  controllers: [DeadlinesController],
  providers: [DeadlinesService],
  exports: [DeadlinesService],
})
export class DeadlinesModule {}
