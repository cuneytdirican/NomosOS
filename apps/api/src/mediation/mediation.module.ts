import { Module } from "@nestjs/common";
import { MediationController } from "./mediation.controller";
import { MediationService } from "./mediation.service";
import { DeadlinesModule } from "../deadlines/deadlines.module";

@Module({
  imports: [DeadlinesModule],
  controllers: [MediationController],
  providers: [MediationService],
  exports: [MediationService],
})
export class MediationModule {}
