import { Module } from "@nestjs/common";
import { PlatformModule } from "../platform/platform.module";
import { PlatformJwtGuard } from "../platform/guards/platform-jwt.guard";
import { PlatformPermissionGuard } from "../platform/guards/platform-permission.guard";
import { PlatformAuditService } from "../platform/platform-audit.service";
import { PlatformFaizOranlariController, PlatformHarcTarifesiController, TarifeController } from "./tarife.controller";
import { TarifeService } from "./tarife.service";

/** Faz 6 — faiz oranı dönemleri + harç tarifesi (platform verisi; kiracı okur, motorlar kullanır). */
@Module({
  imports: [PlatformModule],
  controllers: [TarifeController, PlatformFaizOranlariController, PlatformHarcTarifesiController],
  providers: [TarifeService, PlatformJwtGuard, PlatformPermissionGuard, PlatformAuditService],
  exports: [TarifeService],
})
export class TarifeModule {}
