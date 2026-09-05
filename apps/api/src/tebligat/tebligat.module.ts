import { Module } from "@nestjs/common";
import { DeadlinesModule } from "../deadlines/deadlines.module";
import { TebligatController } from "./tebligat.controller";
import { TebligatSaglayiciRegistry } from "./tebligat-saglayici";
import { TebligatService } from "./tebligat.service";

/** Faz 6 — tebligat varlığı + KEP/UETS sağlayıcı arayüzü (Noop). */
@Module({
  imports: [DeadlinesModule],
  controllers: [TebligatController],
  providers: [TebligatService, TebligatSaglayiciRegistry],
  exports: [TebligatService, TebligatSaglayiciRegistry],
})
export class TebligatModule {}
