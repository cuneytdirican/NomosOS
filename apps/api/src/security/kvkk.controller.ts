/**
 * `/security/kvkk/*` — KVKK saklama/imha + veri öznesi talepleri (Enterprise++).
 *
 *   GET  /security/kvkk/retention                  — politika + imha adayları + talep sayaçları
 *   POST /security/kvkk/retention/cases/:id/anonymize { reason } — imha (yalnız ADMIN, gerekçeli)
 *   GET  /security/kvkk/requests?status=           — veri öznesi talepleri
 *   POST /security/kvkk/requests                    — { clientId, type, subject, requestedAt? }
 *   POST /security/kvkk/requests/:id/respond        — { status: YANITLANDI|REDDEDILDI, decision }
 */

import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { KVKK_REQUEST_TYPES, KvkkService } from "./kvkk.service";

const anonymizeSchema = z.object({
  reason: z.string().trim().min(10, "İmha gerekçesi en az 10 karakter olmalıdır.").max(2000),
});
const createRequestSchema = z.object({
  clientId: z.string().uuid("Geçersiz müvekkil kimliği."),
  type: z.enum(KVKK_REQUEST_TYPES, { errorMap: () => ({ message: "Geçersiz talep türü." }) }),
  subject: z.string().trim().min(3, "Talep konusu en az 3 karakter olmalıdır.").max(4000),
  requestedAt: z.string().optional(),
});
const respondSchema = z.object({
  status: z.enum(["YANITLANDI", "REDDEDILDI"]),
  decision: z.string().trim().min(10, "Yanıt/gerekçe en az 10 karakter olmalıdır.").max(4000),
});

@Controller("security/kvkk")
export class KvkkController {
  constructor(private readonly kvkk: KvkkService) {}

  @Get("retention")
  retention(@CurrentUser() user: AuthUser) {
    return this.kvkk.retentionReport(user);
  }

  @Post("retention/cases/:id/anonymize")
  anonymize(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(anonymizeSchema)) body: z.infer<typeof anonymizeSchema>,
  ) {
    return this.kvkk.anonymizeCase(user, id, body.reason);
  }

  @Get("requests")
  requests(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    return this.kvkk.listRequests(user, { status });
  }

  @Post("requests")
  createRequest(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRequestSchema)) body: z.infer<typeof createRequestSchema>,
  ) {
    return this.kvkk.createRequest(user, body);
  }

  @Post("requests/:id/respond")
  respond(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(respondSchema)) body: z.infer<typeof respondSchema>,
  ) {
    return this.kvkk.respondRequest(user, id, body);
  }
}
