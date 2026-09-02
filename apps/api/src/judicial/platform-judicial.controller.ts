/**
 * YARGI ORGANLARI — platform yönetimi.
 *
 * GET   /judicial/bodies        — katalog araması (q/type/il)
 * POST  /judicial/bodies        — yeni organ ekleme (MANUAL)
 * PATCH /judicial/bodies/:id    — düzeltme / pasifleştirme
 * POST  /judicial/notaries      — yeni noter ekleme
 * PATCH /judicial/notaries/:id  — düzeltme / pasifleştirme
 * GET   /judicial/sync/settings — senkron kaynağı + aralık
 * PUT   /judicial/sync/settings — senkron ayarı (url boşsa zamanlayıcı durur)
 * POST  /judicial/sync          — senkronu şimdi çalıştır
 * GET   /judicial/sync/logs     — son senkron günlükleri
 */

import { Body, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { PlatformController } from "../platform/decorators/platform-controller.decorator";
import { ReadPermission, WritePermission } from "../platform/decorators/platform-permission.decorator";
import { CurrentPlatformUser } from "../platform/decorators/current-platform-user.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform/platform.constants";
import type { PlatformAuthUser } from "../platform/platform.types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { JudicialService, JUDICIAL_BODY_TYPES, MAHKEME_CATEGORIES } from "./judicial.service";

const CATEGORY_VALUES = [...MAHKEME_CATEGORIES, "ICRA"] as [string, ...string[]];

const createBodySchema = z.object({
  type: z.enum(JUDICIAL_BODY_TYPES),
  category: z.enum(CATEGORY_VALUES, { errorMap: () => ({ message: "Geçersiz kategori." }) }),
  name: z.string().trim().min(4, "Ad en az 4 karakter olmalıdır.").max(200),
  il: z.string().trim().min(2, "İl zorunludur.").max(40),
  ilce: z.string().trim().max(60).nullable().optional(),
});

const updateBodySchema = z
  .object({
    name: z.string().trim().min(4).max(200).optional(),
    category: z.enum(CATEGORY_VALUES).optional(),
    il: z.string().trim().min(2).max(40).optional(),
    ilce: z.string().trim().max(60).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Güncellenecek en az bir alan gönderin.");

const createNotarySchema = z.object({
  name: z.string().trim().min(4, "Ad en az 4 karakter olmalıdır.").max(200),
  il: z.string().trim().min(2, "İl zorunludur.").max(40),
  ilce: z.string().trim().max(60).nullable().optional(),
});

const updateNotarySchema = z
  .object({
    name: z.string().trim().min(4).max(200).optional(),
    il: z.string().trim().min(2).max(40).optional(),
    ilce: z.string().trim().max(60).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Güncellenecek en az bir alan gönderin.");

const syncSettingsSchema = z.object({
  url: z.string().trim().max(500).nullable().optional(),
  intervalHours: z.number().int().min(1).max(720).optional(),
});

@PlatformController(`${ADMIN_ROUTE_PREFIX}/judicial`)
export class PlatformJudicialController {
  constructor(private readonly judicial: JudicialService) {}

  @Get("bodies")
  @ReadPermission("judicial.view")
  listBodies(
    @Query("q") q?: string,
    @Query("type") type?: string,
    @Query("il") il?: string,
    @Query("limit") limit?: string,
  ) {
    return this.judicial.adminListBodies({
      q,
      type,
      il,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post("bodies")
  @WritePermission("judicial.manage")
  createBody(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Body(new ZodValidationPipe(createBodySchema)) body: z.infer<typeof createBodySchema>,
  ) {
    return this.judicial.createBody(actor, body);
  }

  @Patch("bodies/:id")
  @WritePermission("judicial.manage")
  updateBody(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBodySchema)) body: z.infer<typeof updateBodySchema>,
  ) {
    return this.judicial.updateBody(actor, id, body);
  }

  @Post("notaries")
  @WritePermission("judicial.manage")
  createNotary(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Body(new ZodValidationPipe(createNotarySchema)) body: z.infer<typeof createNotarySchema>,
  ) {
    return this.judicial.createNotary(actor, body);
  }

  @Patch("notaries/:id")
  @WritePermission("judicial.manage")
  updateNotary(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateNotarySchema)) body: z.infer<typeof updateNotarySchema>,
  ) {
    return this.judicial.updateNotary(actor, id, body);
  }

  @Get("sync/settings")
  @ReadPermission("judicial.view")
  syncSettings() {
    return this.judicial.syncSettings();
  }

  @Put("sync/settings")
  @WritePermission("judicial.manage")
  updateSyncSettings(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Body(new ZodValidationPipe(syncSettingsSchema)) body: z.infer<typeof syncSettingsSchema>,
  ) {
    return this.judicial.updateSyncSettings(actor, body);
  }

  @Post("sync")
  @WritePermission("judicial.manage")
  runSync(@CurrentPlatformUser() actor: PlatformAuthUser) {
    return this.judicial.runSyncNow(actor);
  }

  @Get("sync/logs")
  @ReadPermission("judicial.view")
  syncLogs(@Query("limit") limit?: string) {
    return this.judicial.syncLogs(limit ? parseInt(limit, 10) : undefined);
  }
}
