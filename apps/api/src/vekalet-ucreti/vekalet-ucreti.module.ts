import { Module } from "@nestjs/common";
import { VekaletUcretiController } from "./vekalet-ucreti.controller";
import { VekaletUcretiService } from "./vekalet-ucreti.service";

/**
 * D7 — AAÜT vekalet ücreti modülü (rakip analizi).
 *
 * Motor legal-core'tadır; bu modül tarife saklama + uçlar. Bağımlılık yok:
 * PrismaModule/AuditModule @Global'dir.
 */
@Module({
  controllers: [VekaletUcretiController],
  providers: [VekaletUcretiService],
})
export class VekaletUcretiModule {}
