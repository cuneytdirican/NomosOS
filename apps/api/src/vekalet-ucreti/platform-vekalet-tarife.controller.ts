/**
 * `/api/admin/v1/vekalet-tarife` — PLATFORM AAÜT TARİFESİ (açılış öncesi hazır
 * veri planı, Aşama 2).
 *
 * Platform görevlisi o yılın resmî tarifesini Resmî Gazete'den girer; büro
 * kendi tarifesini girmemişse hesap aracı bu tarifeyi kullanır ve kaynağı
 * (RG künyesi) gösterir. Sistem rakam UYDURMAZ — künye ZORUNLUDUR.
 *
 *   GET  /        — yıllara göre platform tarifeleri
 *   PUT  /:yil    — upsert (judicial.manage: referans katalog yönetimi yetkisi)
 */

import { Body, Get, Param, ParseIntPipe, Put } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PlatformController } from "../platform/decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../platform/decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../platform/decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform/platform.constants";
import type { PlatformAuthUser } from "../platform/platform.types";
import { VekaletUcretiService } from "./vekalet-ucreti.service";

const kurusSchema = z
  .string()
  .regex(/^\d+$/, 'Tutar kuruş cinsinden, yalnız rakam olmalıdır (örn. "1500000" = 15.000,00 TL).');

export const platformTarifeSchema = z.object({
  kademeler: z
    .array(z.object({ limitKurus: kurusSchema.nullable(), ucretKurus: kurusSchema }))
    .min(1, "En az bir maktu kademe gerekir."),
  tekrar: z
    .object({ esikKurus: kurusSchema, birimKurus: kurusSchema, ucretKurus: kurusSchema })
    .nullable()
    .optional(),
  nispiOranYuzde: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "Nispi oran yüzde olarak girin (örn. 16.50)."),
  kdvOrani: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "KDV oranını yüzde olarak girin (örn. 20)."),
  /** Kaynak gösterimi ZORUNLU: "RG 20.12.2025 / 32784" gibi. */
  rgKunye: z
    .string()
    .trim()
    .min(6, "Resmî Gazete künyesi zorunludur (tarih / sayı).")
    .max(120),
});
type PlatformTarifeInput = z.infer<typeof platformTarifeSchema>;

@PlatformController(`${ADMIN_ROUTE_PREFIX}/vekalet-tarife`)
export class PlatformVekaletTarifeController {
  constructor(private readonly vekalet: VekaletUcretiService) {}

  @Get()
  @ReadPermission("judicial.view")
  list() {
    return this.vekalet.platformTarifeListe();
  }

  @Put(":yil")
  @WritePermission("judicial.manage")
  save(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Param("yil", ParseIntPipe) yil: number,
    @Body(new ZodValidationPipe(platformTarifeSchema)) body: PlatformTarifeInput,
  ) {
    if (yil < 2010 || yil > 2100) {
      throw new Error("Yıl 2010-2100 aralığında olmalıdır.");
    }
    return this.vekalet.platformTarifeKaydet(actor, {
      yil,
      kademeler: body.kademeler,
      tekrar: body.tekrar ?? null,
      nispiOranYuzde: body.nispiOranYuzde,
      kdvOrani: body.kdvOrani,
      rgKunye: body.rgKunye,
    });
  }
}
