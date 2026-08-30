import { Module } from "@nestjs/common";
import { AssistantModule } from "../assistant/assistant.module";
import { FinanceController } from "./finance.controller";
import { FinanceService } from "./finance.service";
import { FinanceSummaryService } from "./finance-summary.service";
import { FinanceAiService } from "./finance-ai.service";

/**
 * Modül 08 — Finans.
 *
 * ENTEGRASYON: bu modülü `AppModule.imports` listesine ekleyin (kaydı Entegrasyon
 * ajanı yapar; bu paket `app.module.ts`'e dokunmaz).
 *
 * Bağımlılıklar:
 *   - `AssistantModule` → `AssistantLlmService` (BYO-LLM rota çözümü, KVKK
 *     maskeleme kapısı, output-guard, AiUsageLog). Ham prompt/sağlayıcı çağrısı
 *     bu modülde YOKTUR.
 *   - `PrismaModule` / `AuditModule` global'dir.
 *
 * Dışa aktarılan `FinanceService` ve `FinanceSummaryService`, Faturalama
 * (Modül 09) ve İcra modüllerinin tahsilat/tahakkuk yazması için kullanılır.
 */
@Module({
  imports: [AssistantModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceSummaryService, FinanceAiService],
  exports: [FinanceService, FinanceSummaryService],
})
export class FinanceModule {}
