import { Module } from "@nestjs/common";
import { PetitionsModule } from "../petitions/petitions.module";
import { UyapExtensionController, UyapWebController } from "./uyap.controller";
import { UyapService } from "./uyap.service";
import { UyapTokenGuard } from "./uyap.guard";
import { StorageModule } from "../storage/storage.module";
import { DiskQuotaModule } from "../disk-quota/disk-quota.module";

@Module({
  imports: [StorageModule, DiskQuotaModule, PetitionsModule],
  controllers: [UyapExtensionController, UyapWebController],
  providers: [UyapService, UyapTokenGuard],
  exports: [UyapService],
})
export class UyapModule {}
