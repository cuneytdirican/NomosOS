import { Module } from "@nestjs/common";
import { PipelineModule } from "../pipeline/pipeline.module";
import { StorageModule } from "../storage/storage.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { ProposalsController } from "./proposals.controller";
import { ProposalsService } from "./proposals.service";

/**
 * Belge yönetimi (DMS) + onay kuyruğu.
 *
 * `/documents` uçları belgenin kendisini, `/proposals` uçları belge hattının
 * ürettiği aksiyon önerilerini yönetir. İkisi aynı modülde tutulur çünkü
 * öneriler belgenin yaşam döngüsünün bir parçasıdır.
 */
@Module({
  imports: [StorageModule, PipelineModule],
  controllers: [DocumentsController, ProposalsController],
  providers: [DocumentsService, ProposalsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
