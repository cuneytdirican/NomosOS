import { Module } from "@nestjs/common";
import {
  CaseCaselawController,
  CaseLawReferencesController,
  CaselawController,
} from "./caselaw.controller";
import { CaselawService } from "./caselaw.service";
import { CitationVerifyService } from "./citation-verify.service";
import { AiRunnerService } from "./ai-runner.service";
import { CaseLawAdapterRegistry } from "./adapters/registry.service";
import { LocalDbCaseLawAdapter } from "./adapters/local-db.adapter";
import { ManualEntryCaseLawAdapter } from "./adapters/manual-entry.adapter";

/**
 * İçtihat & Mevzuat modülü (Modül 23).
 *
 * Dışa aktardıkları, Dilekçe Stüdyosu'nun (Modül 22) bağımlılıklarıdır:
 *  - CitationVerifyService → dilekçenin HAZIR statüsüne geçiş kapısı
 *  - CaselawService        → onaylı emsallerin dilekçe bağlamına akması
 *  - AiRunnerService       → ortak BYO-LLM koşu yürütücüsü (KVKK + guard + log)
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */
@Module({
  controllers: [CaselawController, CaseCaselawController, CaseLawReferencesController],
  providers: [
    CaselawService,
    CitationVerifyService,
    AiRunnerService,
    CaseLawAdapterRegistry,
    LocalDbCaseLawAdapter,
    ManualEntryCaseLawAdapter,
  ],
  exports: [CaselawService, CitationVerifyService, AiRunnerService, CaseLawAdapterRegistry],
})
export class CaselawModule {}
