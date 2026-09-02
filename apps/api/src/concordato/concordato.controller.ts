/**
 * KONKORDATO / İFLAS UÇLARI (D4 / A6).
 *
 * GET   /concordatos?processType=&caseId=&status= — liste
 * GET   /concordatos/:id                          — detay
 * POST  /concordatos                              — süreç başlat (HUKUKI)
 * POST  /concordatos/:id/transition               — aşama geçişi (şerit denetimli)
 *
 * Otomatik süre üretimi YOKTUR — bkz. concordato.service.ts dürüstlük notu.
 */

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { ConcordatoService } from "./concordato.service";

const createSchema = z.object({
  processType: z.enum(["CONCORDATO", "IFLAS"], {
    errorMap: () => ({ message: "Süreç türü CONCORDATO veya IFLAS olmalıdır." }),
  }),
  caseId: z.string().uuid().optional(),
  court: z.string().trim().max(200).optional(),
  fileNo: z.string().trim().max(100).optional(),
  stageAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(2000).optional(),
});
export type CreateConcordatoInput = z.infer<typeof createSchema>;

const transitionSchema = z.object({
  status: z.string().min(2, "Hedef aşama zorunludur."),
  stageAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type TransitionConcordatoInput = z.infer<typeof transitionSchema>;

@Controller("concordatos")
export class ConcordatoController {
  constructor(private readonly concordatos: ConcordatoService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("processType") processType?: string,
    @Query("caseId") caseId?: string,
    @Query("status") status?: string,
  ) {
    return this.concordatos.list(user, { processType, caseId, status });
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.concordatos.detail(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: CreateConcordatoInput,
  ) {
    return this.concordatos.create(user, body);
  }

  @Post(":id/transition")
  @HttpCode(200)
  transition(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(transitionSchema)) body: TransitionConcordatoInput,
  ) {
    return this.concordatos.transition(user, id, body);
  }
}
