/**
 * Delil yönetimi HTTP uçları (prefix /api/v1).
 *
 * Dosya altındaki uçlar `/cases/:caseId/...`, tekil kayıt uçları `/claims/:id`
 * ve `/evidence/:id` üzerindedir — mevcut `notes` / `caselaw-references`
 * deseniyle aynı.
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { EvidenceAiService } from "./evidence-ai.service";
import { EvidenceMatrixService } from "./evidence-matrix.service";
import { EvidenceService } from "./evidence.service";
import {
  addLegalBasisSchema,
  createClaimSchema,
  createEvidenceSchema,
  evidenceAiSchema,
  linkEvidenceSchema,
  updateClaimSchema,
  updateEvidenceSchema,
  type AddLegalBasisInput,
  type CreateClaimInput,
  type CreateEvidenceInput,
  type EvidenceAiInput,
  type LinkEvidenceInput,
  type UpdateClaimInput,
  type UpdateEvidenceInput,
} from "./evidence.dto";

/** Dosya kapsamlı uçlar: /cases/:caseId/... */
@Controller("cases")
export class CaseEvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly matrixService: EvidenceMatrixService,
    private readonly ai: EvidenceAiService,
  ) {}

  // ---------- İddialar ----------

  @Get(":caseId/claims")
  listClaims(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Query("side") side?: string,
  ) {
    return this.evidence.listClaims(user, caseId, side);
  }

  @Post(":caseId/claims")
  createClaim(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(createClaimSchema)) body: CreateClaimInput,
  ) {
    return this.evidence.createClaim(user, caseId, body);
  }

  // ---------- Deliller ----------

  @Get(":caseId/evidence")
  listEvidence(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Query("type") type?: string,
    @Query("status") status?: string,
  ) {
    return this.evidence.listEvidence(user, caseId, { type, status });
  }

  @Post(":caseId/evidence")
  createEvidence(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(createEvidenceSchema)) body: CreateEvidenceInput,
  ) {
    return this.evidence.createEvidence(user, caseId, body);
  }

  // ---------- Matris ----------

  /**
   * İSPAT MATRİSİ — DETERMİNİSTİK. Bu uç hiçbir koşulda LLM çağırmaz;
   * desteksiz iddia bayrağı bir sayma işleminin sonucudur.
   */
  @Get(":caseId/evidence-matrix")
  matrix(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.matrixService.matrix(user.tenantId, caseId);
  }

  // ---------- AI (öneri) ----------

  /** EVIDENCE_MATRIX — öneri kuyruğu döner, HİÇBİR KAYIT YAZMAZ. */
  @Post(":caseId/evidence/ai-matrix")
  @AiThrottle(1)
  @AiCredits("EVIDENCE_MATRIX", { caseIdParam: "caseId" })
  @HttpCode(200)
  aiMatrix(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(evidenceAiSchema)) body: EvidenceAiInput,
  ) {
    return this.ai.suggestMatrix(user, caseId, body);
  }

  /** EVIDENCE_GAP — deterministik boşluk listesi + AI yorumu. */
  @Post(":caseId/evidence/gap-analysis")
  @AiThrottle(1)
  @AiCredits("EVIDENCE_GAP", { caseIdParam: "caseId" })
  @HttpCode(200)
  gapAnalysis(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(evidenceAiSchema)) body: EvidenceAiInput,
  ) {
    return this.ai.analyzeGaps(user, caseId, body);
  }
}

/** İddia kayıtları ve matrisin hücreleri: /claims/:id */
@Controller("claims")
export class ClaimsController {
  constructor(private readonly evidence: EvidenceService) {}

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClaimSchema)) body: UpdateClaimInput,
  ) {
    return this.evidence.updateClaim(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.evidence.deleteClaim(user, id);
  }

  /** İddia ↔ delil bağı kurma (matrisin hücresi). */
  @Post(":id/evidence/:evidenceId")
  @HttpCode(201)
  link(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("evidenceId") evidenceId: string,
    @Body(new ZodValidationPipe(linkEvidenceSchema)) body: LinkEvidenceInput,
  ) {
    return this.evidence.linkEvidence(user, id, evidenceId, body);
  }

  @Delete(":id/evidence/:evidenceId")
  unlink(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("evidenceId") evidenceId: string,
  ) {
    return this.evidence.unlinkEvidence(user, id, evidenceId);
  }

  @Post(":id/legal-basis")
  addBasis(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addLegalBasisSchema)) body: AddLegalBasisInput,
  ) {
    return this.evidence.addLegalBasis(user, id, body);
  }

  @Delete(":id/legal-basis/:basisId")
  removeBasis(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("basisId") basisId: string,
  ) {
    return this.evidence.removeLegalBasis(user, id, basisId);
  }
}

/** Delil kayıtları: /evidence/:id */
@Controller("evidence")
export class EvidenceItemsController {
  constructor(private readonly evidence: EvidenceService) {}

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEvidenceSchema)) body: UpdateEvidenceInput,
  ) {
    return this.evidence.updateEvidence(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.evidence.deleteEvidence(user, id);
  }
}
