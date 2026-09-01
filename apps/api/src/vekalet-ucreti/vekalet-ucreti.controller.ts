import { Body, Controller, Get, Param, ParseIntPipe, Put, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { VekaletUcretiService } from "./vekalet-ucreti.service";

/**
 * D7 — AAÜT vekalet ücreti uçları.
 *
 * Kimlik: JwtAuthGuard küreseldir. Tarife yazma ONAY (ADMIN/PARTNER),
 * hesaplama herkese açık (stajyer de hesap makinesini kullanabilir; kayıt
 * değişikliği yapamaz).
 */

const kuruşSchema = z
  .string()
  .regex(/^\d+$/, "Tutar kuruş cinsinden, yalnız rakam olmalıdır (örn. \"1500000\" = 15.000,00 TL).");

const kademeSchema = z.object({
  limitKurus: kuruşSchema.nullable(),
  ucretKurus: kuruşSchema,
});

const tekrarSchema = z.object({
  esikKurus: kuruşSchema,
  birimKurus: kuruşSchema,
  ucretKurus: kuruşSchema,
});

const tarifeSchema = z.object({
  yil: z.coerce.number().int().min(2010).max(2100),
  kademeler: z.array(kademeSchema).min(1, "En az bir maktu kademe gerekir."),
  tekrar: tekrarSchema.nullable().optional(),
  nispiOranYuzde: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "Nispi oran yüzde olarak girin (örn. 16.50)."),
  kdvOrani: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "KDV oranını yüzde olarak girin (örn. 20)."),
});

const hesaplaSchema = z.object({
  davaDegeri: kuruşSchema,
  yil: z.coerce.number().int().min(2010).max(2100),
});

@Controller("vekalet-ucreti")
export class VekaletUcretiController {
  constructor(private readonly vekalet: VekaletUcretiService) {}

  /** POST /vekalet-ucreti/hesapla — hesap + görünür iz. */
  @Post("hesapla")
  hesapla(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(hesaplaSchema))
    input: { davaDegeri: string; yil: number },
  ) {
    return this.vekalet.hesapla(user, input.davaDegeri, input.yil);
  }

  /** GET /vekalet-ucreti/tarife/:yil — tarife okuma. */
  @Get("tarife/:yil")
  tarifeGetir(@CurrentUser() user: AuthUser, @Param("yil", ParseIntPipe) yil: number) {
    return this.vekalet.tarifeGetir(user.tenantId, yil);
  }

  /** PUT /vekalet-ucreti/tarife — tarife upsert (ADMIN/PARTNER). */
  @Put("tarife")
  tarifeKaydet(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(tarifeSchema))
    input: z.infer<typeof tarifeSchema>,
  ) {
    return this.vekalet.tarifeKaydet(user, {
      yil: input.yil,
      kademeler: input.kademeler,
      tekrar: input.tekrar ?? null,
      nispiOranYuzde: input.nispiOranYuzde,
      kdvOrani: input.kdvOrani,
    });
  }
}
