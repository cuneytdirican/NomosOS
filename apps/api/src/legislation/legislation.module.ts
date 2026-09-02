/**
 * Mevzuat kütüphanesi modülü (D3 / A4) — tam metin arama + sürüm notu.
 */

import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PrismaModule } from "../prisma/prisma.module";
import { LegislationController } from "./legislation.controller";
import { LegislationService } from "./legislation.service";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [LegislationController],
  providers: [LegislationService],
  exports: [LegislationService],
})
export class LegislationModule {}
