import { Module } from "@nestjs/common";
import { CaseContextBuilder } from "../assistant/case-context.builder";
import { CaselawModule } from "../caselaw/caselaw.module";
import { StrategyModule } from "../strategy/strategy.module";
import { CaseSimulationController, SimulationController } from "./simulation.controller";
import { SimulationService } from "./simulation.service";

/**
 * Simülasyon Modları (Modül 16).
 *
 * BAĞIMLILIKLAR:
 *  - `CaselawModule` → `AiRunnerService` (BYO-LLM + KVKK kapısı + output-guard)
 *    ve `CitationVerifyService` (atıfların kayıt üzerinden doğrulanması).
 *  - `StrategyModule` → strateji ağacının özeti simülasyon bağlamına girer ve
 *    `inputSnapshot`'ta strateji SÜRÜMÜ referanslanır (tekrarlanabilirlik).
 *  - `CaseContextBuilder` provider olarak verilir (gerekçe: StrategyModule).
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir; bu modül orada
 * `CaselawModule` ve `StrategyModule`'den SONRA import edilmelidir.
 */
@Module({
  imports: [CaselawModule, StrategyModule],
  controllers: [CaseSimulationController, SimulationController],
  providers: [SimulationService, CaseContextBuilder],
  exports: [SimulationService],
})
export class SimulationModule {}
