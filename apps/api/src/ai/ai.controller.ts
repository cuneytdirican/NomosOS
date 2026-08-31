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

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

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

  @Delete("providers/:id")
  deleteProvider(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.aiService.deleteProvider(user, id);
  }

  @Post("providers/:id/test")
  @HttpCode(200)
  testProvider(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.aiService.testProvider(user, id);
  }

  @Get("task-routes")
  listTaskRoutes(@CurrentUser() user: AuthUser) {
    return this.aiService.listTaskRoutes(user.tenantId);
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
