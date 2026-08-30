import { Module } from "@nestjs/common";
import { CaseNotesController, CasesController } from "./cases.controller";
import { CasesService } from "./cases.service";

@Module({
  controllers: [CasesController, CaseNotesController],
  providers: [CasesService],
  exports: [CasesService],
})
export class CasesModule {}
