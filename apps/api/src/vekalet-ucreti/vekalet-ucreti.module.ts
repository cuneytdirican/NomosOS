import { Module } from "@nestjs/common";
import { VekaletUcretiController } from "./vekalet-ucreti.controller";
import { PlatformVekaletTarifeController } from "./platform-vekalet-tarife.controller";
import { VekaletUcretiService } from "./vekalet-ucreti.service";
// Platform tarifesi uçları PlatformJwtGuard + PlatformAuditService ister.
import { PlatformModule } from "../platform/platform.module";

/**
 * D7 — AAÜT vekalet ücreti modülü (rakip analizi).
 *
 * Motor legal-core'tadır; bu modül tarife saklama + uçlar. Bağımlılık yok:
 * PrismaModule/AuditModule @Global'dir.
 */
@Module({
  imports: [PlatformModule],
  controllers: [VekaletUcretiController, PlatformVekaletTarifeController],
  providers: [VekaletUcretiService],
  // Yıl başı AAÜT denetim işi (SchedulerModule) platform tarifesini bu servisten sorar.
  exports: [VekaletUcretiService],
})
export class VekaletUcretiModule {}
