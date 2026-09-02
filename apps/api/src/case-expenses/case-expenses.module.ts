import { Module } from "@nestjs/common";
import { CaseExpensesController, CaseScopedExpensesController } from "./case-expenses.controller";
import { CaseExpensesService } from "./case-expenses.service";

@Module({
  controllers: [CaseExpensesController, CaseScopedExpensesController],
  providers: [CaseExpensesService],
  exports: [CaseExpensesService],
})
export class CaseExpensesModule {}
