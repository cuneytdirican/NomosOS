import { Module } from "@nestjs/common";
import { AssistantModule } from "../assistant/assistant.module";
import { ReportsAiService } from "./reports-ai.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { SavedReportsService } from "./saved-reports.service";

/**
 * Faz 6 — Kurumsal Raporlama.
 *
 * ENTEGRASYON: bu modülü `AppModule.imports` listesine ekleyin (kaydı
 * Entegrasyon ajanı yapar; bu paket `app.module.ts`'e DOKUNMAZ).
 *
 * Bağımlılıklar:
 *   - `AssistantModule` → `AssistantLlmService` (BYO-LLM rota çözümü, KVKK
 *     maskeleme kapısı, output-guard, AiUsageLog). Ham sağlayıcı çağrısı bu
 *     modülde YOKTUR.
 *   - `PrismaModule` / `AuditModule` global'dir.
 *   - Kredi kapısı `CreditsModule`'ün APP_INTERCEPTOR'ıyla çalışır; buraya
 *     ayrıca import GEREKMEZ (`@AiCredits` metadata'sı yeterlidir).
 *
 * ENTEGRASYON AJANINA NOTLAR:
 *   1. `AiTaskCost` satırı eklenmeli: taskType `REPORT_INTERPRET`, credits 5,
 *      isFree false. Satır yoksa uç ÜCRETSİZ çalışır (fail-open) ve açılışta
 *      `CreditsStartupService` hata günlüğü basar.
 *   2. `packages/shared/src/ai-task-types.ts` içine `REPORT_INTERPRET` görev
 *      tipi ve etiketi eklendi (bu ajan tarafından); `@AiCredits` tipli
 *      olduğu için bu ekleme derlemenin ÖN KOŞULUDUR.
 *   3. `AiTaskRoute` kaydı zorunlu değildir: rota bulunamazsa
 *      `AssistantLlmService` sırayla OFFICE_QUERY → CASE_CHAT rotasına, o da
 *      yoksa kiracının ilk aktif sağlayıcısına düşer.
 */
@Module({
  imports: [AssistantModule],
  controllers: [ReportsController],
  providers: [ReportsService, SavedReportsService, ReportsAiService],
  exports: [ReportsService],
})
export class ReportsModule {}
