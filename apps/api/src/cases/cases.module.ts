import { Module } from "@nestjs/common";
import { CaseClosingController } from "./case-closing.controller";
import { CaseClosingService } from "./case-closing.service";
import { CaseNotesController, CasesController } from "./cases.controller";
import { CasesService } from "./cases.service";

@Module({
  controllers: [CasesController, CaseNotesController, CaseClosingController],
  providers: [CasesService, CaseClosingService],
  exports: [CasesService],
})
export class CasesModule {}
