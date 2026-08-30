/**
 * Risk Motoru HTTP uçları (prefix /api/v1).
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */

import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import {
  computeRiskSchema,
  overrideRiskSchema,
  type ComputeRiskInput,
  type OverrideRiskInput,
} from "./risk.dto";
import { RiskService } from "./risk.service";

@Controller("cases")
export class CaseRiskController {
  constructor(private readonly risk: RiskService) {}

  /** GET /cases/:caseId/risk — güncel 8 skor + sinyaller + AI yorumu. */
  @Get(":caseId/risk")
  get(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.risk.get(user, caseId);
  }

  /**
   * POST /cases/:caseId/risk/compute
   *
   * Koşu başına EN ÇOK bir LLM çağrısı yapar (RISK_ASSESS); `useAi=false` ile
   * tamamen deterministik çalışır.
   */
  @AiThrottle(1)
  // useAi:false ile çalışan koşu tamamen deterministiktir; sağlayıcıya
  // hiç gidilmez, dolayısıyla kredi kapısı da çalışmaz.
  @AiCredits("RISK_ASSESS", {
    caseIdParam: "caseId",
    when: (body) => (body as { useAi?: unknown } | undefined)?.useAi !== false,
  })
  @Post(":caseId/risk/compute")
  compute(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(computeRiskSchema)) body: ComputeRiskInput,
  ) {
    return this.risk.compute(user, caseId, body);
  }

  /** GET /cases/:caseId/risk/history?dimension=&from=&to= */
  @Get(":caseId/risk/history")
  history(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Query("dimension") dimension?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.risk.history(user, caseId, { dimension, from, to, page, limit });
  }

  /** POST /cases/:caseId/risk/override — GEREKÇE ZORUNLU. */
  @Post(":caseId/risk/override")
  override(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(overrideRiskSchema)) body: OverrideRiskInput,
  ) {
    return this.risk.override(user, caseId, body);
  }

  /** DELETE /cases/:caseId/risk/override/:dimension */
  @Delete(":caseId/risk/override/:dimension")
  clearOverride(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Param("dimension") dimension: string,
  ) {
    return this.risk.clearOverride(user, caseId, dimension);
  }
}

@Controller("risk")
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  /**
   * GET /risk/office — büro geneli riskli dosyalar.
   *
   * PARTNER/ADMIN tüm dosyaları, AVUKAT yalnızca sorumlusu olduğu dosyaları
   * görür (Modül 17, iş kuralı 8). Partner Dashboard bu ucu tüketir.
   */
  @Get("office")
  office(
    @CurrentUser() user: AuthUser,
    @Query("band") band?: string,
    @Query("dimension") dimension?: string,
    @Query("assigneeId") assigneeId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.risk.office(user, { band, dimension, assigneeId, status, page, limit });
  }
}
