/**
 * HEPO UÇLARI (Modül 28) — docs/moduller/28-hepo-modulu.md.
 *
 * GET   /hepo/obligations?topic=            — ortak yükümlülük kataloğu
 * GET   /hepo/clients/:clientId/obligations?status= — müvekkilin takibi (vade geçmiş işaretli)
 * GET   /hepo/clients/:clientId/summary     — durum kırılımı + vadesi geçen sayısı
 * POST  /hepo/clients/:clientId/obligations — atama (HUKUKI)
 * PATCH /hepo/client-obligations/:id         — durum/vade/güncelleme (HUKUKI)
 */

import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { HepoService } from "./hepo.service";

const assignSchema = z.object({
  obligationId: z.string().uuid("Yükümlülük kimliği geçersiz."),
  dueDate: z.string().date("Vade tarihi YYYY-MM-DD biçiminde olmalıdır.").optional(),
  note: z.string().trim().max(1000, "Not en fazla 1000 karakter olabilir.").optional(),
});
export type HepoAssignInput = z.infer<typeof assignSchema>;

const updateSchema = z.object({
  status: z.enum(["ACIK", "UYGUN", "UYGUN_DEGIL", "IHLAL"]).optional(),
  dueDate: z.string().date().nullable().optional(),
  lastDoneAt: z.string().date().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type HepoUpdateInput = z.infer<typeof updateSchema>;

@Controller("hepo")
export class HepoController {
  constructor(private readonly hepo: HepoService) {}

  @Get("obligations")
  catalog(@Query("topic") topic?: string) {
    return this.hepo.catalog({ topic });
  }

  @Get("clients/:clientId/obligations")
  clientObligations(
    @CurrentUser() user: AuthUser,
    @Param("clientId", ParseUUIDPipe) clientId: string,
    @Query("status") status?: string,
  ) {
    return this.hepo.clientObligations(user, clientId, { status });
  }

  @Get("clients/:clientId/summary")
  summary(
    @CurrentUser() user: AuthUser,
    @Param("clientId", ParseUUIDPipe) clientId: string,
  ) {
    return this.hepo.summary(user, clientId);
  }

  @Post("clients/:clientId/obligations")
  assign(
    @CurrentUser() user: AuthUser,
    @Param("clientId", ParseUUIDPipe) clientId: string,
    @Body(new ZodValidationPipe(assignSchema)) body: HepoAssignInput,
  ) {
    return this.hepo.assign(user, clientId, body);
  }

  @Patch("client-obligations/:id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: HepoUpdateInput,
  ) {
    return this.hepo.update(user, id, body);
  }
}
