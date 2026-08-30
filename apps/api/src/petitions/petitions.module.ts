import { Module } from "@nestjs/common";
import {
  CasePetitionsController,
  PetitionTemplatesController,
  PetitionsController,
} from "./petitions.controller";
import { PetitionsService } from "./petitions.service";
import { PetitionExportStorage } from "./petition-export.storage";
import { CaselawModule } from "../caselaw/caselaw.module";

/**
 * Dilekçe Stüdyosu (Modül 22).
 *
 * CaselawModule'e BAĞIMLIDIR: teyit kapısı (CitationVerifyService), onaylı
 * emsaller (CaselawService) ve ortak BYO-LLM yürütücüsü (AiRunnerService)
 * oradan gelir. Bağımlılık tek yönlüdür — içtihat katmanı dilekçeyi bilmez.
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */
@Module({
  imports: [CaselawModule],
  controllers: [PetitionsController, CasePetitionsController, PetitionTemplatesController],
  providers: [PetitionsService, PetitionExportStorage],
  exports: [PetitionsService],
})
export class PetitionsModule {}
