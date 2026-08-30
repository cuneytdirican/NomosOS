import { Module } from "@nestjs/common";
import { CaselawModule } from "../caselaw/caselaw.module";
import { EvidenceAiService } from "./evidence-ai.service";
import { EvidenceMatrixService } from "./evidence-matrix.service";
import {
  CaseEvidenceController,
  ClaimsController,
  EvidenceItemsController,
} from "./evidence.controller";
import { EvidenceService } from "./evidence.service";

/**
 * Delil Yönetimi (Modül 14) — iddia ↔ delil ↔ belge ↔ hukuki dayanak matrisi.
 *
 * BAĞIMLILIK: `CaselawModule` → ortak BYO-LLM koşu yürütücüsü `AiRunnerService`.
 * Modülün ÇEKİRDEĞİ (matris hesabı) deterministiktir ve AI sağlayıcısı
 * olmadan da tam çalışır; AI yalnızca öneri katmanıdır.
 *
 * `EvidenceMatrixService` dışa aktarılır: Risk Motoru'nun "Delil Riski"
 * boyutu ve Strateji Motoru'nun argüman zinciri aynı deterministik hesabı
 * okumalıdır — iki yerde iki farklı "desteksiz iddia" tanımı olamaz.
 *
 * NOT: app.module.ts kaydı Entegrasyon ajanının işidir; bu modül orada
 * `CaselawModule`'den SONRA import edilmelidir.
 */
@Module({
  imports: [CaselawModule],
  controllers: [CaseEvidenceController, ClaimsController, EvidenceItemsController],
  providers: [EvidenceService, EvidenceMatrixService, EvidenceAiService],
  exports: [EvidenceService, EvidenceMatrixService],
})
export class EvidenceModule {}
