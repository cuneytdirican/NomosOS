/**
 * Kurumsal raporlama HTTP uçları (prefix /api/v1).
 *
 *   GET    /reports/catalog                 · rol süzgeçli rapor kataloğu
 *   GET    /reports/runs                    · çalıştırma denetim geçmişi
 *   GET    /reports/saved                   · kayıtlı rapor tanımları
 *   POST   /reports/saved                   · yeni kayıtlı rapor
 *   PATCH  /reports/saved/:id               · kayıtlı raporu güncelle
 *   DELETE /reports/saved/:id               · kayıtlı raporu sil
 *   POST   /reports/saved/:id/run           · kayıtlı tanımı çalıştır
 *   GET    /reports/:key                    · raporu çalıştır (ekran)
 *   GET    /reports/:key/export?format=csv  · CSV dışa aktarım
 *   POST   /reports/:key/interpret          · AI yorumu (kredili, opsiyonel)
 *
 * ROTA SIRASI KRİTİKTİR: `catalog`, `runs` ve `saved` sabit yolları `:key`
 * rotasından ÖNCE tanımlanır; aksi hâlde "saved" bir rapor anahtarı sanılır ve
 * kayıtlı rapor uçlarının hiçbirine erişilemez.
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AiCredits } from "../credits/ai-credits.decorator";
import type { AuthUser } from "../common/types";
import { buildCsv, contentDisposition, csvFileName } from "./report-csv";
import { ReportsAiService } from "./reports-ai.service";
import { ReportsService } from "./reports.service";
import { SavedReportsService } from "./saved-reports.service";
import {
  createSavedReportSchema,
  interpretReportSchema,
  runSavedReportSchema,
  updateSavedReportSchema,
  type CreateSavedReportInput,
  type InterpretReportInput,
  type RunSavedReportInput,
  type UpdateSavedReportInput,
} from "./reports.dto";

/**
 * Rapor PARAMETRESİ olmayan sorgu anahtarları. Bunlar `ReportRun.paramsJson`
 * ve `SavedReport.paramsJson` içine SIZMAMALIDIR: "format=csv" bir filtre
 * değildir ve kaydedilirse kayıtlı raporun filtresi gibi görünür.
 */
const NON_PARAM_QUERY_KEYS = new Set(["format", "tablo", "meta"]);

function extractParams(query: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!NON_PARAM_QUERY_KEYS.has(key)) params[key] = value;
  }
  return params;
}

@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly saved: SavedReportsService,
    private readonly ai: ReportsAiService,
  ) {}

  /* ─────────────────────────── Katalog ─────────────────────────── */

  /** Kullanıcı YALNIZ yetkili olduğu raporları görür. */
  @Get("catalog")
  catalog(@CurrentUser() user: AuthUser) {
    return this.reports.catalog(user);
  }

  /** Denetim: kim, hangi raporu, hangi filtreyle, ne zaman çalıştırdı. */
  @Get("runs")
  runs(
    @CurrentUser() user: AuthUser,
    @Query("reportKey") reportKey?: string,
    @Query("limit") limit?: string,
  ) {
    return this.reports.runHistory(user, {
      reportKey: reportKey?.trim() || undefined,
      limit: Number.parseInt(limit ?? "", 10) || 50,
    });
  }

  /* ──────────────────────── Kayıtlı raporlar ──────────────────────── */

  @Get("saved")
  listSaved(@CurrentUser() user: AuthUser) {
    return this.saved.list(user);
  }

  @Post("saved")
  createSaved(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSavedReportSchema)) body: CreateSavedReportInput,
  ) {
    return this.saved.create(user, body);
  }

  @Patch("saved/:id")
  updateSaved(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSavedReportSchema)) body: UpdateSavedReportInput,
  ) {
    return this.saved.update(user, id, body);
  }

  @Delete("saved/:id")
  deleteSaved(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.saved.remove(user, id);
  }

  /** Kayıtlı tanımı çalıştırır; gövdedeki `params` kayıtlı filtreyi geçici olarak ezer. */
  @Post("saved/:id/run")
  runSaved(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(runSavedReportSchema)) body: RunSavedReportInput,
  ) {
    return this.saved.run(user, id, body.params ?? {});
  }

  /* ────────────────────────── Rapor çalıştırma ────────────────────────── */

  /**
   * CSV DIŞA AKTARIM.
   *
   * `:key` rotasından ÖNCE tanımlıdır (Nest, daha uzun ve sabit son eki olan
   * yolu kendiliğinden öne almaz; sıra bildirim sırasıdır).
   *
   * PDF: bu fazda ÜRETİLMEZ. Arayüz tarayıcının yazdırma diyaloğunu kullanır;
   * gerekçe report-csv.ts başlığında. `format=pdf` isteği açıkça 400 döner —
   * sessizce CSV vermek, kullanıcının yanlış dosyayı paylaşmasına yol açardı.
   */
  @Get(":key/export")
  async exportReport(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const format = (query.format ?? "csv").toLowerCase();
    if (format !== "csv") {
      res.status(400).json({
        statusCode: 400,
        message:
          format === "pdf"
            ? "PDF dışa aktarım bu sürümde sunucu tarafında üretilmiyor. Raporu ekranda " +
              "açıp tarayıcının yazdırma penceresinden (Ctrl+P → PDF olarak kaydet) alabilirsiniz."
            : `Desteklenmeyen biçim: ${format}. Şu an yalnız "csv" desteklenir.`,
      });
      return;
    }

    const def = this.reports.definitionOf(user, key);
    const result = await this.reports.run(user, def.key, extractParams(query), "CSV");
    const table = this.reports.pickTable(result, def, query.tablo?.trim() || undefined);
    const csv = buildCsv(result, table, { includeMeta: query.meta !== "false" });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", contentDisposition(csvFileName(result, table)));
    // Rapor verisi kiracıya özeldir; ara belleklerde tutulmasın.
    res.setHeader("Cache-Control", "no-store");
    res.send(csv);
  }

  /**
   * AI YORUMU — OPSİYONEL VE KREDİLİDİR.
   *
   * `@AiCredits("REPORT_INTERPRET")`: fiyat satırı `AiTaskCost` tablosundadır
   * (Entegrasyon ajanına not: REPORT_INTERPRET = 5 kredi). Satır yoksa kapı
   * fail-open davranır (ücretsiz çalışır) ve açılışta `CreditsStartupService`
   * bunu hata olarak günlüğe yazar.
   *
   * `contextChars`: kapı, rapor sonucunun uzunluğunu göremez (rapor handler
   * içinde hesaplanır); gövde küçüktür, bu yüzden tahmin taban fiyattır.
   */
  @Post(":key/interpret")
  @AiThrottle(1)
  @AiCredits("REPORT_INTERPRET")
  interpret(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(interpretReportSchema)) body: InterpretReportInput,
  ) {
    return this.ai.interpret(user, key, body);
  }

  /** Raporu çalıştırır. Rol kapısı ve dönem çözümü servistedir. */
  @Get(":key")
  run(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Query() query: Record<string, string>,
  ) {
    return this.reports.run(user, key, extractParams(query), "EKRAN");
  }
}
