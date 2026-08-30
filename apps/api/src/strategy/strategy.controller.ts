/**
 * Strateji Motoru HTTP uçları (prefix /api/v1).
 *
 * Dosya altında (`/cases/:caseId/strategy`) ve tekil olarak (`/strategy/:id`,
 * `/strategy-versions/:id`) adreslenir — mevcut caselaw/petitions deseniyle aynı.
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */

import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { StrategyBuildService } from "./strategy-build.service";
import {
  buildStrategySchema,
  createNodeSchema,
  createStrategySchema,
  publishVersionSchema,
  setStatusSchema,
  updateNodeSchema,
  type BuildStrategyInput,
  type CreateNodeInput,
  type CreateStrategyInput,
  type PublishVersionInput,
  type SetStatusInput,
  type UpdateNodeInput,
} from "./strategy.dto";
import { StrategyService } from "./strategy.service";

/** Dosya altındaki uçlar. */
@Controller("cases")
export class CaseStrategyController {
  constructor(private readonly strategies: StrategyService) {}

  @Get(":caseId/strategy")
  get(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.strategies.getForCase(user, caseId);
  }

  @Post(":caseId/strategy")
  create(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(createStrategySchema)) body: CreateStrategyInput,
  ) {
    return this.strategies.createForCase(user, caseId, body);
  }
}

@Controller("strategy")
export class StrategyController {
  constructor(
    private readonly strategies: StrategyService,
    private readonly builder: StrategyBuildService,
  ) {}

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.strategies.detailById(user, id);
  }

  @Patch(":id/status")
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setStatusSchema)) body: SetStatusInput,
  ) {
    return this.strategies.setStatus(user, id, body);
  }

  // ---------- Sürümler ----------

  @Get(":id/versions")
  versions(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.strategies.listVersions(user, id, { page, limit });
  }

  @Post(":id/versions")
  publish(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(publishVersionSchema)) body: PublishVersionInput,
  ) {
    return this.strategies.publishVersion(user, id, body);
  }

  // ---------- AI üretimi ----------

  /** Tek istek = tek LLM çağrısı; hız sınırı pahalı uçlarla aynı bütçeden düşer. */
  @AiThrottle(1)
  // Strateji koşusu dosyanın TAMAMINA bakar (belge parçaları, safahat, notlar,
  // delil matrisi). Yolda `:caseId` yok; bağlam uzunluğu stratejinin bağlı
  // olduğu dosyadan ölçülür — yoksa 50 kredi tavanı hiç tetiklenmez ve uzun
  // bağlam çarpanı hiç tahsil edilmezdi.
  @AiCredits("STRATEGY_BUILD", { parentCaseId: { kind: "STRATEGY", param: "id" } })
  @Post(":id/build")
  build(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(buildStrategySchema)) body: BuildStrategyInput,
  ) {
    return this.builder.build(user, id, body);
  }

  // ---------- Düğümler ----------

  @Post(":id/nodes")
  createNode(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createNodeSchema)) body: CreateNodeInput,
  ) {
    return this.strategies.createNode(user, id, body);
  }

  @Patch(":id/nodes/:nodeId")
  updateNode(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("nodeId") nodeId: string,
    @Body(new ZodValidationPipe(updateNodeSchema)) body: UpdateNodeInput,
  ) {
    return this.strategies.updateNode(user, id, nodeId, body);
  }

  @Delete(":id/nodes/:nodeId")
  deleteNode(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("nodeId") nodeId: string,
  ) {
    return this.strategies.deleteNode(user, id, nodeId);
  }
}

@Controller("strategy-versions")
export class StrategyVersionsController {
  constructor(private readonly strategies: StrategyService) {}

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.strategies.getVersion(user, id);
  }
}
