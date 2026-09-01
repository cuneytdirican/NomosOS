import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { RandevuService, RANDEVU_STATULERI } from "./randevu.service";

/**
 * E9 — RANDEVU (büro tarafı). Kimlik: JwtAuthGuard küreseldir; her rol
 * randevu alabilir (ajanda sekreter işidir), durum değişimi serviste
 * OPERASYON rolü gerektirir.
 */

const createSchema = z.object({
  title: z.string().trim().min(3, "Randevu konusu zorunludur.").max(200),
  startAt: z.coerce.date({ invalid_type_error: "Başlangıç geçerli bir tarih olmalıdır." }),
  endAt: z.coerce.date({ invalid_type_error: "Bitiş geçerli bir tarih olmalıdır." }),
  clientId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

@Controller("randevular")
export class RandevuController {
  constructor(private readonly randevu: RandevuService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("status") status?: string,
  ) {
    return this.randevu.list(user, { from, to, status });
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema))
    input: z.infer<typeof createSchema>,
  ) {
    return this.randevu.create(user, {
      title: input.title,
      startAt: input.startAt,
      endAt: input.endAt,
      clientId: input.clientId ?? null,
      note: input.note ?? null,
    });
  }

  @Patch(":id")
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(RANDEVU_STATULERI) })))
    body: { status: (typeof RANDEVU_STATULERI)[number] },
  ) {
    return this.randevu.updateStatus(user, id, body.status);
  }
}
