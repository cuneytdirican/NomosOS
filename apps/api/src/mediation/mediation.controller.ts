/**
 * ARABULUCULUK UÇLARI.
 *
 * GET   /mediations?status=&caseId= — liste
 * GET   /mediations/:id             — detay
 * POST  /mediations                 — süreç başlat (DAVET)
 * POST  /mediations/:id/transition  — durum geçişi (ANLASMA_YOK'ta 2 hafta
 *                                     dava süresi otomatik üretilir)
 */

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { MediationService, MEDIATION_STATUSES } from "./mediation.service";

const createSchema = z.object({
  title: z.string().trim().min(3, "Başlık en az 3 karakter olmalıdır.").max(300),
  caseId: z.string().uuid("Geçerli bir dosya seçin.").optional(),
  clientId: z.string().uuid("Geçerli bir müvekkil seçin.").optional(),
  meetingAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(2000).optional(),
});
export type CreateMediationInput = z.infer<typeof createSchema>;

const transitionSchema = z.object({
  status: z.enum(MEDIATION_STATUSES, { errorMap: () => ({ message: "Geçersiz durum." }) }),
  meetingAt: z.string().datetime().nullable().optional(),
  finalProtocolAt: z.string().datetime().nullable().optional(),
  settlementAmount: z.number().positive().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  caseId: z.string().uuid().optional(),
});
export type TransitionMediationInput = z.infer<typeof transitionSchema>;

@Controller("mediations")
export class MediationController {
  constructor(private readonly mediations: MediationService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("caseId") caseId?: string,
  ) {
    return this.mediations.list(user, { status, caseId });
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.mediations.detail(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: CreateMediationInput,
  ) {
    return this.mediations.create(user, body);
  }

  @Post(":id/transition")
  @HttpCode(200)
  transition(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(transitionSchema)) body: TransitionMediationInput,
  ) {
    return this.mediations.transition(user, id, body);
  }
}
