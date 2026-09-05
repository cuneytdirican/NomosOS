/**
 * İcra modülü HTTP uçları (prefix /api/v1).
 *
 * Alt kayıtlar hem dosya altında (`/enforcement/:id/actions`) hem tekil olarak
 * (`/enforcement-actions/:id`, `/assets/:id`) adreslenir — mevcut `notes`
 * deseniyle aynı.
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { EnforcementCopilotService } from "./copilot.service";
import { CollectionScoreService } from "./collection-score.service";
import { EnforcementService } from "./enforcement.service";
import { EnforcementAssetMarketService, APPRAISER_TYPES, SALE_RESULTS, SALE_TYPES } from "./enforcement-asset-market.service";
import {
  changeStageSchema,
  copilotSchema,
  createActionSchema,
  createAssetSchema,
  createCollectionSchema,
  createEnforcementSchema,
  suggestDeadlinesSchema,
  updateActionSchema,
  updateAssetSchema,
  updateEnforcementSchema,
  type ChangeStageInput,
  type CopilotInput,
  type CreateActionInput,
  type CreateAssetInput,
  type CreateCollectionInput,
  type CreateEnforcementInput,
  type SuggestDeadlinesInput,
  type UpdateActionInput,
  type UpdateAssetInput,
  type UpdateEnforcementInput,
} from "./enforcement.dto";

/* ---------------- D4 / A6: kıymet takdiri + satış şemaları ---------------- */

const createValuationSchema = z.object({
  appraiserType: z.enum(APPRAISER_TYPES, {
    errorMap: () => ({ message: "Geçersiz takdiri yapan türü (bilirkişi/icra memuru/encümen)." }),
  }),
  appraiserName: z.string().trim().max(200).optional(),
  appraisedValue: z.number().positive("Takdir bedeli pozitif olmalıdır."),
  appraisedAt: z.string().datetime({ message: "Takdir tarihi zorunludur." }),
  note: z.string().trim().max(2000).optional(),
});
export type CreateValuationInput = z.infer<typeof createValuationSchema>;

const createSaleSchema = z.object({
  saleType: z.enum(SALE_TYPES, {
    errorMap: () => ({ message: "Geçersiz satış türü (açık artırma / posta ile teklif)." }),
  }),
  saleDate: z.string().datetime({ message: "Satış tarihi zorunludur." }),
  minimumBid: z.number().positive().nullable().optional(),
  depositRatio: z.number().min(0).max(100).nullable().optional(),
  result: z.enum(SALE_RESULTS, {
    errorMap: () => ({ message: "Geçersiz satış sonucu." }),
  }),
  soldAmount: z.number().positive().nullable().optional(),
  buyerName: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

@RequiresModule("icra")
@Controller("enforcement")
export class EnforcementController {
  constructor(
    private readonly enforcement: EnforcementService,
    private readonly copilot: EnforcementCopilotService,
    private readonly score: CollectionScoreService,
  ) {}

  // ---------- Takip dosyası ----------

  /** Faz 6 — portföy özeti (aşama dağılımı, alacak/tahsilat, vadesi geçmiş süreler, hareketsiz dosyalar). */
  @Get("portfolio")
  portfolio(@CurrentUser() user: AuthUser) {
    return this.enforcement.portfolio(user);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("stage") stage?: string,
    @Query("trackingType") trackingType?: string,
    @Query("clientId") clientId?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.enforcement.list(user, { stage, trackingType, clientId, q, page, limit });
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createEnforcementSchema)) body: CreateEnforcementInput,
  ) {
    return this.enforcement.create(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("asOf") asOf?: string) {
    return this.enforcement.detail(user, id, asOf);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEnforcementSchema)) body: UpdateEnforcementInput,
  ) {
    return this.enforcement.update(user, id, body);
  }

  /** Aşama geçişi — geçersiz geçiş 422 döner (bkz. enforcement-stage.ts). */
  @Patch(":id/stage")
  changeStage(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(changeStageSchema)) body: ChangeStageInput,
  ) {
    return this.enforcement.changeStage(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.enforcement.remove(user, id);
  }

  // ---------- Safahat ----------

  @Get(":id/actions")
  listActions(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("type") type?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.enforcement.listActions(user, id, { type, page, limit });
  }

  @Post(":id/actions")
  createAction(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createActionSchema)) body: CreateActionInput,
  ) {
    return this.enforcement.createAction(user, id, body);
  }

  // ---------- Malvarlığı ----------

  @Get(":id/assets")
  listAssets(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("status") status?: string) {
    return this.enforcement.listAssets(user, id, { status });
  }

  @Post(":id/assets")
  createAsset(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createAssetSchema)) body: CreateAssetInput,
  ) {
    return this.enforcement.createAsset(user, id, body);
  }

  // ---------- Tahsilat ----------

  @Get(":id/collections")
  listCollections(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.enforcement.listCollections(user, id);
  }

  @Post(":id/collections")
  createCollection(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createCollectionSchema)) body: CreateCollectionInput,
  ) {
    return this.enforcement.createCollection(user, id, body);
  }

  // ---------- Bakiye (deterministik, AI YOK) ----------

  @Get(":id/balance")
  balance(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("asOf") asOf?: string) {
    return this.enforcement.getBalance(user, id, asOf);
  }

  // ---------- Süre motoru köprüsü ----------

  /** Hesap gösterir, KAYIT YAZMAZ. */
  @Get(":id/deadlines")
  previewDeadlines(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.enforcement.previewDeadlines(user, id);
  }

  /** `persist: true` ile süreler ONAY BEKLİYOR (BEKLIYOR) durumunda açılır. */
  @Post(":id/deadlines/suggest")
  @HttpCode(200)
  suggestDeadlines(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(suggestDeadlinesSchema)) body: SuggestDeadlinesInput,
  ) {
    return this.enforcement.suggestDeadlines(user, id, body);
  }

  // ---------- Tahsilat skoru ----------

  /** En son hesaplanan skor kaydı (yeni hesap için copilot komutunu kullanın). */
  @Get(":id/score")
  latestScore(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    // Tahsil kabiliyeti skoru finansal bir değerlendirmedir; rol kapısı
    // servis katmanındadır (doğrudan servis çağrısı da korunsun).
    return this.enforcement.latestScore(user, id);
  }

  // ---------- İcra AI Copilot ----------

  /**
   * Altı komut da ÖNERİ üretir. Dış sağlayıcı + kişisel veri + onay yoksa
   * 409 `requiresPiiApproval` döner; AI sağlayıcısı tanımlı değilse 400.
   */
  @Post(":id/copilot")
  @AiThrottle(1)
  @AiCredits("ENFORCEMENT_ANALYSIS", {
    // TAHSILAT_IHTIMALI ayrı bir kalemdir (15 kredi); diğer beş komut
    // ENFORCEMENT_ANALYSIS (10 kredi) fiyatından geçer.
    taskTypeFrom: (body) =>
      (body as { command?: string } | undefined)?.command === "TAHSILAT_IHTIMALI"
        ? "COLLECTION_LIKELIHOOD"
        : undefined,
    // Yolda icra dosyası kimliği var; bağlam ise bağlı DAVA dosyasında durur.
    parentCaseId: { kind: "ENFORCEMENT", param: "id" },
  })
  @HttpCode(200)
  copilotRun(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(copilotSchema)) body: CopilotInput,
  ) {
    return this.copilot.run(user, id, body);
  }
}

/** Safahat kayıtları dosyadan bağımsız da adreslenir. */
@RequiresModule("icra")
@Controller("enforcement-actions")
export class EnforcementActionsController {
  constructor(private readonly enforcement: EnforcementService) {}

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateActionSchema)) body: UpdateActionInput,
  ) {
    return this.enforcement.updateAction(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.enforcement.removeAction(user, id);
  }
}

/** Malvarlığı kayıtları dosyadan bağımsız da adreslenir. */
@RequiresModule("icra")
@Controller("assets")
export class AssetsController {
  constructor(
    private readonly enforcement: EnforcementService,
    private readonly assetMarket: EnforcementAssetMarketService,
  ) {}

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAssetSchema)) body: UpdateAssetInput,
  ) {
    return this.enforcement.updateAsset(user, id, body);
  }

  // ---------- D4 / A6: kıymet takdiri (İİK m.120) + satış (m.106+) ----------

  @Get(":id/valuations")
  listValuations(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.assetMarket.listValuations(user, id);
  }

  @Post(":id/valuations")
  addValuation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createValuationSchema)) body: CreateValuationInput,
  ) {
    return this.assetMarket.addValuation(user, id, body);
  }

  @Get(":id/sales")
  listSales(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.assetMarket.listSales(user, id);
  }

  @Post(":id/sales")
  addSale(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createSaleSchema)) body: CreateSaleInput,
  ) {
    return this.assetMarket.addSale(user, id, body);
  }
}
