import { Module } from "@nestjs/common";
import { AssistantController } from "./assistant.controller";
import { AssistantService } from "./assistant.service";
import { AssistantLlmService } from "./assistant-llm.service";
import { CaseContextBuilder } from "./case-context.builder";
import { IndexingService } from "./indexing.service";
import { RetrievalService } from "./retrieval.service";
import { OfficeQueryService } from "./office-query.service";
// D1.3: BYO yetkisi + platform sağlayıcı yedeği için.
import { AiModule } from "../ai/ai.module";

/**
 * AI Dosya Asistanı (Modül 24) — RAG indeksleme, dosya sohbeti, tam dosya
 * analizi, akıllı notlar ve büro geneli sorgu.
 *
 * Entegrasyon: bu modülü `AppModule.imports` listesine ekleyin.
 * PrismaModule ve AuditService global/paylaşılan modüllerden gelir.
 *
 * Dışa aktarılanlar (`IndexingService`, `RetrievalService`) Belge hattının
 * (Modül 06 pipeline) yükleme sonrası indeksleme adımını çağırabilmesi içindir.
 */
@Module({
  imports: [AiModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantLlmService,
    CaseContextBuilder,
    IndexingService,
    RetrievalService,
    OfficeQueryService,
  ],
  exports: [AssistantService, AssistantLlmService, IndexingService, RetrievalService, CaseContextBuilder],
})
export class AssistantModule {}
