import { Module } from "@nestjs/common";
import { CaselawModule } from "../caselaw/caselaw.module";
import { ConflictInferenceService } from "./conflict-ai.service";
import { ConflictCheckController, ConflictChecksController } from "./conflict.controller";
import { ConflictService } from "./conflict.service";

/**
 * Çıkar Çatışması Taraması (Modül 11).
 *
 * BAĞIMLILIK: `CaselawModule` → ortak BYO-LLM koşu yürütücüsü `AiRunnerService`
 * (KVKK kapısı + output-guard + AiUsageLog). Modülün ÇEKİRDEĞİ deterministiktir;
 * AI yalnızca opsiyonel ikinci katmandır ve sağlayıcı yoksa tarama yine çalışır.
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir; bu modül orada
 * `CaselawModule`'den SONRA import edilmelidir.
 */
@Module({
  imports: [CaselawModule],
  controllers: [ConflictCheckController, ConflictChecksController],
  providers: [ConflictService, ConflictInferenceService],
  exports: [ConflictService],
})
export class ConflictModule {}
