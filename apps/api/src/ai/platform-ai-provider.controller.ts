/**
 * PLATFORM AI SAĞLAYICI YÖNETİMİ — `/api/admin/v1/ai/providers`.
 *
 * GET    /            — liste (anahtar ASLA dönmez)
 * POST   /            — ekle (anahtar AES-256-GCM şifreli)
 * PATCH  /:id         — güncelle (anahtar verilirse yeniden şifrelenir)
 * DELETE /:id        — sil
 * POST   /:id/test    — bağlantı testi
 * POST   /:id/models — sağlayıcıdan model listesini ÇEK (elle giriş yok)
 */

import { Body, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { AI_PROVIDER_TYPES } from "@nomosos/shared";
import { PlatformController } from "../platform/decorators/platform-controller.decorator";
import { ReadPermission, WritePermission } from "../platform/decorators/platform-permission.decorator";
import { CurrentPlatformUser } from "../platform/decorators/current-platform-user.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform/platform.constants";
import type { PlatformAuthUser } from "../platform/platform.types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PlatformAiService } from "./platform-ai.service";

const providerTypes = z.enum(AI_PROVIDER_TYPES, {
  errorMap: () => ({ message: "Geçersiz sağlayıcı türü." }),
});

const createSchema = z.object({
  name: z.string().trim().min(2, "Ad en az 2 karakter olmalıdır.").max(80),
  type: providerTypes,
  apiKey: z.string().trim().max(500).optional(),
  baseUrl: z.string().trim().max(500).optional(),
  defaultModel: z.string().trim().min(1, "Varsayılan model zorunludur.").max(200),
  headers: z.record(z.string()).optional(),
  mapping: z
    .object({
      requestMessagesField: z.string(),
      requestModelField: z.string(),
      responseTextField: z.string(),
    })
    .optional(),
  isDefault: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type PlatformProviderCreateInput = z.infer<typeof createSchema>;

/** Eğitilmiş model KAYDI içe aktarma (platform kataloğu) — model kimliği externalModelId. */
const importSchema = createSchema.omit({ defaultModel: true }).extend({
  externalModelId: z
    .string()
    .trim()
    .min(1, "Eğitilmiş model kimliği zorunludur.")
    .max(200, "Model kimliği en fazla 200 karakter olabilir."),
});
type PlatformProviderImportInput = z.infer<typeof importSchema>;

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    type: providerTypes.optional(),
    apiKey: z.string().trim().max(500).optional(),
    baseUrl: z.string().trim().max(500).nullable().optional(),
    defaultModel: z.string().trim().min(1).max(200).optional(),
    headers: z.record(z.string()).optional(),
    mapping: z
      .object({
        requestMessagesField: z.string(),
        requestModelField: z.string(),
        responseTextField: z.string(),
      })
      .optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type PlatformProviderUpdateInput = z.infer<typeof updateSchema>;

@PlatformController(`${ADMIN_ROUTE_PREFIX}/ai/providers`)
export class PlatformAiProviderController {
  constructor(private readonly platformAi: PlatformAiService) {}

  @Get()
  @ReadPermission("aiProvider.view")
  list() {
    return this.platformAi.listProviders();
  }

  @Post()
  @WritePermission("aiProvider.manage")
  create(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: PlatformProviderCreateInput,
  ) {
    return this.platformAi.createProvider(actor, body);
  }

  /**
   * POST /import — dışarıda eğitilmiş model KAYDINI platform kataloğuna al
   * (kullanıcı tanımlı model, gereksinim 3). Ağırlık dosyası sisteme girmez;
   * kayıt origin=IMPORTED ile normal sağlayıcı olarak kullanılır.
   */
  @Post("import")
  @WritePermission("aiProvider.manage")
  importTrainedModel(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Body(new ZodValidationPipe(importSchema)) body: PlatformProviderImportInput,
  ) {
    const { externalModelId, ...rest } = body;
    return this.platformAi.createProvider(actor, { ...rest, defaultModel: externalModelId, origin: "IMPORTED" });
  }

  @Patch(":id")
  @WritePermission("aiProvider.manage")
  update(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: PlatformProviderUpdateInput,
  ) {
    return this.platformAi.updateProvider(actor, id, body);
  }

  @Delete(":id")
  @WritePermission("aiProvider.manage")
  remove(@CurrentPlatformUser() actor: PlatformAuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.platformAi.deleteProvider(actor, id);
  }

  @Post(":id/test")
  @HttpCode(200)
  @WritePermission("aiProvider.manage")
  test(@Param("id", ParseUUIDPipe) id: string) {
    return this.platformAi.testProvider(id);
  }

  /** Model listesi sağlayıcıdan ÇEKİLİR — elle model adı yazımı bitmeli. */
  @Post(":id/models")
  @HttpCode(200)
  @WritePermission("aiProvider.manage")
  models(@Param("id", ParseUUIDPipe) id: string) {
    return this.platformAi.listProviderModels(id).then((models) => ({ models }));
  }
}
