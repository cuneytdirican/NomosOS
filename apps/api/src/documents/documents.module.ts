import { Module } from "@nestjs/common";
import { PipelineModule } from "../pipeline/pipeline.module";
import { StorageModule } from "../storage/storage.module";
import { DiskQuotaModule } from "../disk-quota/disk-quota.module";
import { AiTrainingModule } from "../ai-training/ai-training.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { ProposalsController } from "./proposals.controller";
import { ProposalsService } from "./proposals.service";
import { DocumentExtrasService } from "./document-extras.service";
import { PublicShareController } from "./public-share.controller";

/**
 * Belge yönetimi (DMS) + onay kuyruğu.
 *
 * `/documents` uçları belgenin kendisini, `/proposals` uçları belge hattının
 * ürettiği aksiyon önerilerini yönetir. İkisi aynı modülde tutulur çünkü
 * öneriler belgenin yaşam döngüsünün bir parçasıdır.
 */
@Module({
  imports: [StorageModule, PipelineModule, DiskQuotaModule, AiTrainingModule],
  controllers: [DocumentsController, ProposalsController, PublicShareController],
  providers: [DocumentsService, ProposalsService, DocumentExtrasService],
  exports: [DocumentsService, DocumentExtrasService],
})
export class DocumentsModule {}
