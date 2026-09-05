import { Module } from "@nestjs/common";
import { TermsController } from "./terms.controller";
import { TermsService } from "./terms.service";

/** FAZ 8B — sözleşme kabulü. PlatformModule kiracı geçmişi için TermsService'i içe alır. */
@Module({
  controllers: [TermsController],
  providers: [TermsService],
  exports: [TermsService],
})
export class TermsModule {}
