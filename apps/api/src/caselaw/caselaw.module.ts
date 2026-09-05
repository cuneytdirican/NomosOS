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
import { YargitayLiveAdapter, EMSAL_LIVE, EMSAL_LIVE_CONFIG } from "./adapters/yargitay-live.adapter";
import { AymLiveAdapter } from "./adapters/aym-live.adapter";
import { UyusmazlikLiveAdapter } from "./adapters/uyusmazlik-live.adapter";
// D1.3: BYO yetkisi + platform sağlayıcı yedeği için.
import { AiModule } from "../ai/ai.module";
// Faz 1 (mevzuat besleme): CitationVerifyService mevzuat atıflarını platform
// kanun havuzundan (Statute) doğrular — arama servisi Legislation modülündedir.
import { LegislationModule } from "../legislation/legislation.module";

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
  imports: [AiModule, LegislationModule],
  controllers: [CaselawController, CaseCaselawController, CaseLawReferencesController],
  providers: [
    // CANLI katman: resmî karararama.yargitay.gov.tr arama istemcisi.
    YargitayLiveAdapter,
    // CANLI katman 2: Emsal/UYAP — tüm mahkeme dereceleri (aynı sözleşme,
    // ayrı yapılandırma; DI anahtarıyla ayrılır).
    { provide: EMSAL_LIVE, useValue: new YargitayLiveAdapter(EMSAL_LIVE_CONFIG) },
    CaselawService,
    CitationVerifyService,
    AiRunnerService,
    CaseLawAdapterRegistry,
    LocalDbCaseLawAdapter,
    ManualEntryCaseLawAdapter,
    // Canlı künye teyidi adaptörleri (Faz 2) — kaynak kapılı, yalnız kendi
    // mahkemesini adlandıran künyelerde ağa çıkar.
    AymLiveAdapter,
    UyusmazlikLiveAdapter,
  ],
  exports: [CaselawService, CitationVerifyService, AiRunnerService, CaseLawAdapterRegistry],
})
export class CaselawModule {}
