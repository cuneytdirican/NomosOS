/**
 * Mevzuat kütüphanesi modülü (D3 / A4) — tam metin arama + sürüm notu.
 *
 * PLATFORM MEVZUAT HAVUZU (hukuki veri kaynağı besleme planı): kanun havuzu
 * (Statute/StatuteArticleVersion) platform tarafında doldurulur
 * (legislation-ingest onay hattı); bu modül kiracıya OKUMA ve atıf teyidi
 * (StatuteLookupService) sağlar.
 */

import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PrismaModule } from "../prisma/prisma.module";
import { LegislationController } from "./legislation.controller";
import { LegislationService } from "./legislation.service";
import { StatuteLookupService } from "./statute-lookup.service";
import { MevzuatGovConnector } from "./connectors/mevzuat-gov.connector";
import { ResmiGazeteClient } from "./connectors/resmi-gazete.client";
import { KvkkClient } from "./connectors/kvkk.client";
import { RekabetClient } from "./connectors/rekabet.client";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [LegislationController],
  providers: [
    LegislationService,
    StatuteLookupService,
    MevzuatGovConnector,
    ResmiGazeteClient,
    KvkkClient,
    RekabetClient,
  ],
  exports: [
    LegislationService,
    StatuteLookupService,
    MevzuatGovConnector,
    ResmiGazeteClient,
    KvkkClient,
    RekabetClient,
  ],
})
export class LegislationModule {}
