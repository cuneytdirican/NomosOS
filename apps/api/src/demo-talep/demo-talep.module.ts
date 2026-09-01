import { Module } from "@nestjs/common";
import { DemoTalepController } from "./demo-talep.controller";
import { DemoTalepService } from "./demo-talep.service";

/**
 * DEMO TALEBİ MODÜLÜ — tanıtım sitesi formu → DemoRequest kaydı.
 * İzleme platform panelindedir (PlatformModule /demo-requests).
 */
@Module({
  controllers: [DemoTalepController],
  providers: [DemoTalepService],
})
export class DemoTalepModule {}
