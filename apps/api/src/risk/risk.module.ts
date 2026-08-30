import { Module } from "@nestjs/common";
import { CaseContextBuilder } from "../assistant/case-context.builder";
import { CaselawModule } from "../caselaw/caselaw.module";
import { CaseRiskController, RiskController } from "./risk.controller";
import { RiskService } from "./risk.service";

/**
 * Risk Motoru (Modül 17).
 *
 * BAĞIMLILIKLAR:
 *  - `CaselawModule` → yalnızca `AiRunnerService` (RISK_ASSESS koşusu:
 *    KVKK kapısı + output-guard + AiUsageLog). Motorun kural yarısı hiçbir
 *    dış bağımlılık kullanmaz ve AI olmadan da çalışır.
 *  - `CaseContextBuilder` provider olarak verilir (gerekçe: StrategyModule).
 *  - `PrismaModule` / `AuditModule` @Global olduğu için ayrıca import edilmez.
 *
 * `StrategyModule` ve `SimulationModule` İMPORT EDİLMEZ: risk motoru strateji
 * düğümlerini ve simülasyon koşularını doğrudan Prisma'dan SAYAR (yorumlamaz).
 * Böylece üç modül arasında döngüsel bağımlılık oluşmaz.
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir.
 */
@Module({
  imports: [CaselawModule],
  controllers: [CaseRiskController, RiskController],
  providers: [RiskService, CaseContextBuilder],
  exports: [RiskService],
})
export class RiskModule {}
