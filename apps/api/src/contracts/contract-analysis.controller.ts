/**
 * Sözleşme Analizi ve Simülasyon HTTP uçları (prefix /api/v1, /contracts altında).
 *
 *   GET  /contracts/analyses/latest-scores      · liste kartları için skor bandı
 *   GET  /contracts/:id/analyses/estimate       · parça/kredi tahmini (AI'sız)
 *   GET  /contracts/:id/analyses                 · koşu arşivi
 *   POST /contracts/:id/analyses                 · iki taraflı analiz (kredili, parça bazlı)
 *   GET  /contracts/:id/analyses/:runId          · tek koşu (şerhleriyle)
 *   GET  /contracts/:id/annotations              · şerhler (?status=ACIK, sayfalı)
 *   POST /contracts/:id/annotations/:aid/close   · şerh kapat (gerekçe zorunlu)
 *   GET  /contracts/:id/diff                     · sürüm farkı (sayfa pencereli, sayfalı)
 *   GET  /contracts/:id/events                   · süreç akışı (append-only, sayfalı)
 *   GET  /contracts/:id/risk-summary              · güncel skor (açık şerhlerden)
 *   POST /contracts/:id/notify-client            · kritik şerh özeti → portal
 *   GET/PUT /contracts/:id/notify-setting         · bildirim kipi (MANUAL/OTOMATIK)
 *
 * ROTA SIRASI: "analyses/latest-scores" ve "analyses/estimate" sabit yolları
 * `:id`/`:runId` rotalarından ÖNCE tanımlanır; aksi hâlde bir sözleşme/koşu
 * kimliği sanılır (renewals ile aynı kural).
 */

import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AiCredits } from "../credits/ai-credits.decorator";
import type { AuthUser } from "../common/types";
import { ContractAnalysisService } from "./contract-analysis.service";
import {
  closeAnnotationSchema,
  contractDiffSchema,
  notifyClientSchema,
  runContractAnalysisSchema,
  setNotifyModeSchema,
  type CloseAnnotationInput,
  type ContractDiffInput,
  type NotifyClientInput,
  type RunContractAnalysisInput,
  type SetNotifyModeInput,
} from "./contract-analysis.dto";

@Controller("contracts")
export class ContractAnalysisController {
  constructor(private readonly analysis: ContractAnalysisService) {}

  /* ---------------- Sabit yollar (`:id`den ÖNCE) ---------------- */

  /**
   * Sözleşme başına en son koşunun skoru — liste kartındaki renk bandının
   * kaynağı. HESAP DETERMİNİSTİKTİR — AI yok, kredi tüketilmez.
   */
  @Get("analyses/latest-scores")
  latestScores(@CurrentUser() user: AuthUser) {
    return this.analysis.latestRunScores(user);
  }

  /* ---------------------------- Analiz --------------------------- */

  /**
   * İki taraflı sözleşme analizi — PARÇA BAZLI (map-reduce). Kredi hattı
   * `parentContract` ile sözleşme metnini ölçer: fiyat = parça sayısı ×
   * parça başına fiyat (`AiTaskCost` satırı parça başına geçerlidir). REVİZYON
   * modunda önceki açık şerhler SUPERSEDED olur; NIHAI mod HUKUKI rolleredir.
   */
  @Post(":id/analyses")
  @AiThrottle(1)
  @AiCredits("CONTRACT_ANALYSIS", {
    parentContract: {
      param: "id",
      versionIdFrom: (body) => {
        const versionId = (body as { versionId?: unknown } | undefined)?.versionId;
        return typeof versionId === "string" && versionId.length > 0 ? versionId : undefined;
      },
    },
  })
  @HttpCode(200)
  runAnalysis(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(runContractAnalysisSchema)) body: RunContractAnalysisInput,
  ) {
    return this.analysis.analyze(user, id, body);
  }

  /**
   * Analiz tahmini — parça sayısı, sayfa sayısı ve tahmini kredi. DETERMİNİSTİK:
   * metin aynı chunker hesabıyla bölünür; AI çağrısı yok, kredi tüketilmez.
   * Tahmin ve gerçek koşu AYNI hesabı kullandığı için tutarlıdır.
   */
  @Get(":id/analyses/estimate")
  analysisEstimate(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("versionId") versionId?: string,
  ) {
    return this.analysis.analysisEstimate(user, id, versionId);
  }

  @Get(":id/analyses")
  listAnalyses(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.analysis.listAnalyses(user, id, { page, limit });
  }

  @Get(":id/analyses/:runId")
  analysisDetail(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("runId") runId: string,
  ) {
    return this.analysis.analysisDetail(user, id, runId);
  }

  /* ---------------------------- Şerhler -------------------------- */

  @Get(":id/annotations")
  listAnnotations(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.analysis.listAnnotations(user, id, { status, page, limit });
  }

  /** Şerh kapatma — GEREKÇE ZORUNLUDUR; SUPERSEDED şerh kapatılamaz. */
  @Post(":id/annotations/:annotationId/close")
  @HttpCode(200)
  closeAnnotation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("annotationId") annotationId: string,
    @Body(new ZodValidationPipe(closeAnnotationSchema)) body: CloseAnnotationInput,
  ) {
    return this.analysis.closeAnnotation(user, id, annotationId, body);
  }

  /* ------------------------ Sürüm farkı ------------------------- */

  /**
   * İki sürümün sayfa pencereli farkı — SUNUCUDA üretilir, iz kaydına yazılır.
   * Değişmeyen sayfalar ATLANIR; yanıt yalnızca değişen sayfaları SAYFALANMIŞ
   * döndürür (`page`/`limit`).
   */
  @Get(":id/diff")
  diff(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(contractDiffSchema)) query: ContractDiffInput,
  ) {
    return this.analysis.diff(user, id, query);
  }

  /* ------------------------- Süreç akışı ------------------------ */

  /**
   * Append-only olay akışı — zaman çizelgesi SON N olayla açılır, geçmiş
   * "daha fazla" ile yüklenir (take/skip). 30 sn yoklamayla canlı.
   */
  @Get(":id/events")
  listEvents(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.analysis.listEvents(user, id, { page, limit });
  }

  /* ------------------------ Risk özeti --------------------------- */

  /** Güncel skor — yalnızca AÇIK şerhlerden yeniden hesaplanır. */
  @Get(":id/risk-summary")
  riskSummary(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.analysis.riskSummary(user, id);
  }

  /* --------------------- Müvekkil bildirimi --------------------- */

  /**
   * Kritik şerh özeti müvekkil portalına yayınlanır. Özet SUNUCUDA
   * deterministik kurulur (AI yok, kredi yok); onaylayan HUKUKİ rol
   * kullanıcısıdır.
   */
  @Post(":id/notify-client")
  @HttpCode(200)
  notifyClient(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(notifyClientSchema)) body: NotifyClientInput,
  ) {
    return this.analysis.notifyClient(user, id, body);
  }

  @Get(":id/notify-setting")
  getNotifySetting(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.analysis.getNotifySetting(user, id);
  }

  /** Otomatik bildirim kipi — açma PARTNER+ yetkisidir. */
  @Put(":id/notify-setting")
  setNotifyMode(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setNotifyModeSchema)) body: SetNotifyModeInput,
  ) {
    return this.analysis.setNotifyMode(user, id, body);
  }
}
