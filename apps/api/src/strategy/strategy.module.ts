import { Module } from "@nestjs/common";
import { CaseContextBuilder } from "../assistant/case-context.builder";
import { CaselawModule } from "../caselaw/caselaw.module";
import { StrategyBuildService } from "./strategy-build.service";
import {
  CaseStrategyController,
  StrategyController,
  StrategyVersionsController,
} from "./strategy.controller";
import { StrategyService } from "./strategy.service";

/**
 * Strateji Motoru (Modül 15).
 *
 * BAĞIMLILIKLAR:
 *  - `CaselawModule` → `AiRunnerService` (BYO-LLM koşusu: KVKK kapısı +
 *    output-guard + AiUsageLog), `CaselawService` (onaylı emsaller) ve
 *    `CitationVerifyService` (atıfların KAYIT ÜZERİNDEN doğrulanması).
 *  - `CaseContextBuilder` doğrudan PROVIDER olarak verilir. Sınıf
 *    `assistant` klasöründe durur ama `AssistantModule` onu dışa aktarmaz ve o
 *    dosya bu turda başka bir ajanın sahipliğindedir. Sınıfın tek bağımlılığı
 *    @Global `PrismaService` olduğu için ikinci bir örnek üretmek zararsızdır
 *    (durum tutmaz). Entegrasyon aşamasında `AssistantModule` bu sınıfı dışa
 *    aktarırsa bu satır kaldırılıp modül import edilebilir.
 *  - `PrismaModule` / `AuditModule` @Global olduğu için ayrıca import edilmez.
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir; bu modül orada
 * `CaselawModule`'den SONRA import edilmelidir.
 */
@Module({
  imports: [CaselawModule],
  controllers: [CaseStrategyController, StrategyController, StrategyVersionsController],
  providers: [StrategyService, StrategyBuildService, CaseContextBuilder],
  exports: [StrategyService],
})
export class StrategyModule {}
