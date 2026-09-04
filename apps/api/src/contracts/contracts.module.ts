import { Module } from "@nestjs/common";
import { CaselawModule } from "../caselaw/caselaw.module";
import { CreditsModule } from "../credits/credits.module";
import { PortalModule } from "../portal/portal.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { ContractRenewalService } from "./contract-renewal.service";
import { ContractsAiService } from "./contracts-ai.service";
import { ContractsSignatureService } from "./contracts-signature.service";
import {
  ContractVersionsController,
  ContractsController,
  SignatureProvidersController,
  SignatureRequestsController,
} from "./contracts.controller";
import { ContractsService } from "./contracts.service";
import { ContractAnalysisController } from "./contract-analysis.controller";
import { ContractAnalysisService } from "./contract-analysis.service";

/**
 * Sözleşme Yaşam Döngüsü + E-imza (Modül 20) + Sözleşme Analizi.
 *
 * BAĞIMLILIKLAR:
 *  - `CaselawModule` → ortak BYO-LLM koşu yürütücüsü `AiRunnerService`
 *    (KVKK kapısı + output-guard + AiUsageLog). CONTRACT_REVIEW ve
 *    CONTRACT_ANALYSIS bunu kullanır.
 *  - `PortalModule` → müvekkil bildiriminin portal görünürlüğünü allow-list'e
 *    yazan `PortalPublicationService` (görünürlük kararı tek yerde kalır).
 *  - `SchedulerModule` → avukat otomatik bildirimi için `NotificationOutboxService`
 *    (dedupe'li giden kutusu; çift bildirim üretmez).
 *  - `CreditsModule` → analiz TAHMİN ucunun fiyat hesabı (`CreditService.
 *    estimateForUnits`). Kredi KAPISI zaten `APP_INTERCEPTOR`'dur; bu import
 *    yalnızca tahmin ucunun FİYAT OKUMASI içindir (kredi tüketmez).
 *  - `PrismaModule` / `AuditModule` @Global olduğu için ayrıca import edilmez.
 *  - `@nomosos/e-signature` bir NestJS modülü DEĞİLDİR; saf bir kütüphanedir ve
 *    `ContractsSignatureService` içinde fonksiyon olarak kullanılır. Bu bilinçli:
 *    adaptör katmanının Nest yaşam döngüsüne bağlanması, sağlayıcı eklemeyi
 *    çerçeveye bağımlı hâle getirirdi.
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir; bu modül orada
 * `CaselawModule`'den SONRA import edilmelidir.
 */
@Module({
  imports: [CaselawModule, PortalModule, SchedulerModule, CreditsModule],
  controllers: [
    ContractsController,
    ContractVersionsController,
    SignatureRequestsController,
    SignatureProvidersController,
    ContractAnalysisController,
  ],
  providers: [
    ContractsService,
    ContractRenewalService,
    ContractsSignatureService,
    ContractsAiService,
    ContractAnalysisService,
  ],
  exports: [ContractsService, ContractRenewalService, ContractAnalysisService],
})
export class ContractsModule {}
