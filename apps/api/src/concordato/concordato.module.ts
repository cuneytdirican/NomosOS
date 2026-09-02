/** Konkordato / iflas süreç modülü (D4 / A6) — şerit denetimli aşama takibi. */

import { Module } from "@nestjs/common";
import { ConcordatoController } from "./concordato.controller";
import { ConcordatoService } from "./concordato.service";

@Module({
  controllers: [ConcordatoController],
  providers: [ConcordatoService],
  exports: [ConcordatoService],
})
export class ConcordatoModule {}
