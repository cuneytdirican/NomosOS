import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import { z } from "zod";
import {
  aiProviderConfigSchema,
  aiTaskRouteSchema,
  caseChatSchema,
  type AiProviderConfigInput,
  type AiTaskRouteInput,
  type CaseChatInput,
} from "@nomosos/shared";
import { AiService } from "./ai.service";
import { PlatformAiService } from "./platform-ai.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";

/**
 * PATCH /ai/policy — büronun AI veri politikası.
 *
 * `aiPolicy = SADECE_YEREL`: büro ağı dışındaki hiçbir AI adresine istek
 * yapılmaz. `autoMaskConsent`: otomatik belge hattının dış sağlayıcıya MASKELİ
 * metin göndermesine verilen kayıtlı rıza (docs/04, kabul kriteri 1).
 */
const updateAiPolicySchema = z
  .object({
    aiPolicy: z.enum(["SERBEST", "SADECE_YEREL"]).optional(),
    autoMaskConsent: z.boolean().optional(),
  })
  .refine((v) => v.aiPolicy !== undefined || v.autoMaskConsent !== undefined, {
    message: "Güncellenecek bir alan gönderin (aiPolicy veya autoMaskConsent).",
  });
type UpdateAiPolicyInput = z.infer<typeof updateAiPolicySchema>;

/**
 * Eğitilmiş model KAYDI içe aktarma — sağlayıcı şemasının aynısı; model
 * kimliği `externalModelId` (sağlayıcının döndürdüğü fine-tuned model adı).
 */
const importTrainedModelSchema = aiProviderConfigSchema.omit({ defaultModel: true }).extend({
  externalModelId: z
    .string()
    .trim()
    .min(1, "Eğitilmiş model kimliği zorunludur (sağlayıcının döndürdüğü model adı).")
    .max(200, "Model kimliği en fazla 200 karakter olabilir."),
});
type ImportTrainedModelInput = z.infer<typeof importTrainedModelSchema>;

/** Model önizleme girişi (kaydetmeden) — D1.3b. */
const previewModelsSchema = z.object({
  type: z.enum(["ANTHROPIC", "OPENAI_COMPAT", "GEMINI", "OLLAMA", "CUSTOM"]),
  apiKey: z.string().trim().max(500).optional(),
  baseUrl: z.string().trim().max(500).optional(),
});

@Controller("ai")
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly platformAi: PlatformAiService,
  ) {}

  /**
   * GET /ai/platform-status — büronun AI yetki durumu (D1.3):
   * BYO izni var mı; yoksa kullanılacak platform sağlayıcısı (ANAHTARSIZ).
   * Arayüz kilitli görünümü bu uçtan beslenir.
   */
  @Get("platform-status")
  platformStatus(@CurrentUser() user: AuthUser) {
    return this.platformAi.tenantStatus(user.tenantId);
  }

  /** Büronun AI veri politikası (KVKK). */
  @Get("policy")
  getPolicy(@CurrentUser() user: AuthUser) {
    return this.aiService.getPolicy(user.tenantId);
  }

  @Patch("policy")
  updatePolicy(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateAiPolicySchema)) body: UpdateAiPolicyInput,
  ) {
    return this.aiService.updatePolicy(user, body);
  }

  @Get("providers")
  listProviders(@CurrentUser() user: AuthUser) {
    return this.aiService.listProviders(user);
  }

  @Post("providers")
  createProvider(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(aiProviderConfigSchema)) body: AiProviderConfigInput
  ) {
    return this.aiService.createProvider(user, body);
  }

  /**
   * POST /ai/providers/import — dışarıda eğitilmiş model KAYDINI içe aktar
   * (kullanıcı tanımlı model, gereksinim 3). BYO plan kapısı + SSRF + şifreleme
   * createProvider ile ortaktır; kayıt origin=IMPORTED rozetiyle listelenir.
   */
  @Post("providers/import")
  importTrainedModel(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importTrainedModelSchema)) body: ImportTrainedModelInput,
  ) {
    return this.aiService.importTrainedModel(user, body);
  }

  @Delete("providers/:id")
  deleteProvider(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.aiService.deleteProvider(user, id);
  }

  @Post("providers/:id/test")
  @HttpCode(200)
  testProvider(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.aiService.testProvider(user, id);
  }

  /**
   * POST /ai/providers/:id/models — sağlayıcıdan model listesini ÇEK (D1.3b):
   * model adı ELLE yazılmaz, seçilir. Kiracı kendi sağlayıcısından çeker.
   */
  @Post("providers/:id/models")
  @HttpCode(200)
  fetchProviderModels(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.aiService.fetchProviderModels(user, id);
  }

  /** POST /ai/providers/models-preview — KAYDETMEDEN model listesi (D1.3b). */
  @Post("providers/models-preview")
  @HttpCode(200)
  previewProviderModels(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(previewModelsSchema)) body: z.infer<typeof previewModelsSchema>,
  ) {
    return this.aiService.previewProviderModels(user, body);
  }

  @Get("task-routes")
  listTaskRoutes(@CurrentUser() user: AuthUser) {
    return this.aiService.listTaskRoutes(user);
  }

  @Put("task-routes")
  upsertTaskRoute(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(aiTaskRouteSchema)) body: AiTaskRouteInput
  ) {
    return this.aiService.upsertTaskRoute(user, body);
  }

  @Post("chat")
  @AiThrottle(1)
  // Dosya kimliği gövdededir; bağlam uzunluğu ölçüme buradan katılır.
  @AiCredits("CASE_CHAT", {
    caseIdFrom: (body) => (body as { caseId?: string } | undefined)?.caseId,
  })
  @HttpCode(200)
  chat(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(caseChatSchema)) body: CaseChatInput) {
    return this.aiService.chat(user, body);
  }
}
