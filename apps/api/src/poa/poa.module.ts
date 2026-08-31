import { Module } from "@nestjs/common";
import { CaselawModule } from "../caselaw/caselaw.module";
import { PoaScopeService } from "./poa-scope.service";
import { PoaWarningsService } from "./poa-warnings.service";
import { CasePoaController, PoaController } from "./poa.controller";
import { PoaService } from "./poa.service";

/**
 * Vekaletname Yönetimi (Modül 12).
 *
 * BAĞIMLILIKLAR:
 *  - `CaselawModule` → ortak BYO-LLM koşu yürütücüsü `AiRunnerService`
 *    (KVKK kapısı + output-guard + AiUsageLog). Kapsam analizi bunu kullanır.
 *  - `PrismaModule` / `AuditModule` @Global olduğu için ayrıca import edilmez.
 *  - `CreditsModule` import EDİLMEZ: kredi kapısı `APP_INTERCEPTOR`dır ve
 *    `@AiCredits()` metadata'sıyla çalışır.
 *
 * `PoaWarningsService` DIŞA AKTARILIR: dosya açılışı ve duruşma hazırlık
 * paketi (Modül 03) dosyanın vekalet durumunu buradan okuyabilsin diye.
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir; bu modül orada
 * `CaselawModule`'den SONRA import edilmelidir.
 */
@Module({
  imports: [CaselawModule],
  controllers: [PoaController, CasePoaController],
  providers: [PoaService, PoaWarningsService, PoaScopeService],
  exports: [PoaService, PoaWarningsService],
})
export class PoaModule {}
