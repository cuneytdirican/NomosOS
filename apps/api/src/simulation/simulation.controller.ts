/**
 * Simülasyon Modları HTTP uçları (prefix /api/v1).
 *
 * ROTA SIRASI ÖNEMLİDİR: `/simulations/compare` ve `/simulations/modes`,
 * `/simulations/:id`'den ÖNCE tanımlanmalıdır; aksi halde "compare" bir koşu
 * kimliği sanılır.
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */

import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { runSimulationSchema, type RunSimulationInput } from "./simulation.dto";
import { SimulationService } from "./simulation.service";

@Controller("cases")
export class CaseSimulationController {
  constructor(private readonly simulations: SimulationService) {}

  /** POST /cases/:caseId/simulate — tek istek = tek LLM çağrısı. */
  @AiThrottle(1)
  // Beş mod iki fiyat kalemine eşlenir (ikisi de 20 kredi); eşleme
  // simulation.modes.ts içindeki `taskType` alanlarıyla BİREBİRDİR.
  @AiCredits("JUDGE_SIMULATION", {
    caseIdParam: "caseId",
    taskTypeFrom: (body) => {
      const mode = (body as { mode?: string } | undefined)?.mode;
      return mode === "KARSI_TARAF_AVUKATI" || mode === "KARSI_DILEKCE_ZAYIFLIK"
        ? "OPPONENT_SIMULATION"
        : undefined;
    },
  })
  @Post(":caseId/simulate")
  run(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(runSimulationSchema)) body: RunSimulationInput,
  ) {
    return this.simulations.run(user, caseId, body);
  }

  /** Dosya altındaki koşu listesi — arayüz kolaylığı. */
  @Get(":caseId/simulations")
  listForCase(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Query("mode") mode?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.simulations.list(user, { caseId, mode, page, limit });
  }
}

@Controller("simulations")
export class SimulationController {
  constructor(private readonly simulations: SimulationService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("caseId") caseId?: string,
    @Query("mode") mode?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.simulations.list(user, { caseId, mode, page, limit });
  }

  /** Sabit yollar :id'den ÖNCE. */
  @Get("modes")
  modes() {
    return this.simulations.listModes();
  }

  @Get("compare")
  compare(@CurrentUser() user: AuthUser, @Query("a") a: string, @Query("b") b: string) {
    return this.simulations.compare(user, a, b);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.simulations.detail(user, id);
  }
}
