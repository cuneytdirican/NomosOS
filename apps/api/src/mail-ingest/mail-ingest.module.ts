import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { MailIngestController } from "./mail-ingest.controller";
import { MailIngestService } from "./mail-ingest.service";
import { IMAP_CLIENT, ImapFlowClient } from "./imap-client";

/** FAZ 7A — e-posta ile belge girişi (IMAP). Zamanlayıcı işi SchedulerModule'de kayıtlıdır. */
@Module({
  imports: [DocumentsModule],
  controllers: [MailIngestController],
  providers: [MailIngestService, { provide: IMAP_CLIENT, useClass: ImapFlowClient }],
  exports: [MailIngestService],
})
export class MailIngestModule {}
