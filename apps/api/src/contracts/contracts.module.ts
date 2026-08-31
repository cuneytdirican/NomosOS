import { Module } from "@nestjs/common";
import { CaselawModule } from "../caselaw/caselaw.module";
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

/**
 * Sözleşme Yaşam Döngüsü + E-imza (Modül 20).
 *
 * BAĞIMLILIKLAR:
 *  - `CaselawModule` → ortak BYO-LLM koşu yürütücüsü `AiRunnerService`
 *    (KVKK kapısı + output-guard + AiUsageLog). CONTRACT_REVIEW bunu kullanır.
 *  - `PrismaModule` / `AuditModule` @Global olduğu için ayrıca import edilmez.
 *  - `CreditsModule` import EDİLMEZ: kredi kapısı `APP_INTERCEPTOR`dır.
 *  - `@nomosos/e-signature` bir NestJS modülü DEĞİLDİR; saf bir kütüphanedir ve
 *    `ContractsSignatureService` içinde fonksiyon olarak kullanılır. Bu bilinçli:
 *    adaptör katmanının Nest yaşam döngüsüne bağlanması, sağlayıcı eklemeyi
 *    çerçeveye bağımlı hâle getirirdi.
 *
 * ENTEGRASYON NOTU: `apps/api/package.json`a `"@nomosos/e-signature": "workspace:*"`
 * satırının eklenmesi gerekir (bkz. dönüş raporu).
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir; bu modül orada
 * `CaselawModule`'den SONRA import edilmelidir.
 */
@Module({
  imports: [CaselawModule],
  controllers: [
    ContractsController,
    ContractVersionsController,
    SignatureRequestsController,
    SignatureProvidersController,
  ],
  providers: [
    ContractsService,
    ContractRenewalService,
    ContractsSignatureService,
    ContractsAiService,
  ],
  exports: [ContractsService, ContractRenewalService],
})
export class ContractsModule {}
