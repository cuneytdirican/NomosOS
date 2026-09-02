import { Module } from "@nestjs/common";
import { DiskQuotaController } from "./disk-quota.controller";
import { DiskQuotaService } from "./disk-quota.service";

@Module({
  controllers: [DiskQuotaController],
  providers: [DiskQuotaService],
  exports: [DiskQuotaService],
})
export class DiskQuotaModule {}
