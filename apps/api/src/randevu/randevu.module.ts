import { Module } from "@nestjs/common";
import { RandevuController } from "./randevu.controller";
import { RandevuService } from "./randevu.service";

/**
 * E9 — randevu modülü. Büro ajandası + portal self-servisi (portal uçları
 * PortalModule'de `randevu` servisini enjekte eder).
 */
@Module({
  controllers: [RandevuController],
  providers: [RandevuService],
  exports: [RandevuService],
})
export class RandevuModule {}
