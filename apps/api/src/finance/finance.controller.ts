import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { renderExport, type ExportFormat } from "./finance-export";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import type { AuthUser } from "../common/types";
import { FinanceService } from "./finance.service";
import { FinanceSummaryService } from "./finance-summary.service";
import { FinanceAiService } from "./finance-ai.service";
import {
  createFinancialEntrySchema,
  financeAskSchema,
  updateFinancialEntrySchema,
  type CreateFinancialEntryInput,
  type FinanceAskInput,
  type UpdateFinancialEntryInput,
} from "./finance.dto";

/**
 * Modül 08 — Finans uçları. Tümü `/api/v1/finance` altındadır.
 *
 * Rol kapıları servis katmanındadır (denetim kaydıyla birlikte); controller
 * yalnızca doğrulama ve yönlendirme yapar.
 */
@RequiresModule("finans")
@Controller("finance")
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly summaries: FinanceSummaryService,
    private readonly ai: FinanceAiService,
  ) {}

  // ---------------------------------------------------------------- özetler
  // NOT: sabit yollar `:id` içeren yollardan ÖNCE tanımlanır.

  /** GET /finance/summary — büro geneli pano (dönem: from/to, varsayılan bu ay). */
  @Get("summary")
  officeSummary(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    return this.summaries.officeSummary(user, { from, to });
  }

  /** GET /finance/clients/:clientId/summary — müvekkil finans özeti. */
  @Get("clients/:clientId/summary")
  clientSummary(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    return this.summaries.clientSummary(user, clientId);
  }

  /** GET /finance/cases/:caseId/summary — dosya finans özeti. */
  @Get("cases/:caseId/summary")
  caseSummary(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.summaries.caseSummary(user, caseId);
  }

  // ------------------------------------------------------------------- AI

  /** POST /finance/ask — CLIENT_FINANCIAL_SUMMARY (tutarlar API'den, AI'dan değil). */
  @Post("ask")
  @AiThrottle()
  @AiCredits("CLIENT_FINANCIAL_SUMMARY")
  ask(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(financeAskSchema)) body: FinanceAskInput) {
    return this.ai.ask(user, body);
  }

  // -------------------------------------------------------------- hareketler

  /** Faz 6 — muhasebe dışa aktarımı (Luca / Logo CSV). */
  @Get("export")
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("clientId") clientId?: string,
  ) {
    if (format !== undefined && format !== "luca" && format !== "logo") {
      throw new BadRequestException("Geçersiz dışa aktarım biçimi; 'luca' ya da 'logo' olmalıdır.");
    }
    const fmt: ExportFormat = format === "logo" ? "logo" : "luca";
    const entries = await this.finance.exportEntries(user, { from, to, clientId });
    const out = renderExport(fmt, entries);
    res.setHeader("Content-Type", out.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.send(out.body);
  }

  @Get("entries")
  listEntries(
    @CurrentUser() user: AuthUser,
    @Query("clientId") clientId?: string,
    @Query("caseId") caseId?: string,
    @Query("type") type?: string,
    @Query("currency") currency?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("invoiced") invoiced?: string,
    @Query("isBillable") isBillable?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.finance.list(user, {
      clientId,
      caseId,
      type,
      currency,
      from,
      to,
      invoiced,
      isBillable,
      page,
      limit,
    });
  }

  @Post("entries")
  createEntry(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFinancialEntrySchema)) body: CreateFinancialEntryInput,
  ) {
    return this.finance.create(user, body);
  }

  @Get("entries/:id")
  entryDetail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.finance.detail(user, id);
  }

  @Patch("entries/:id")
  updateEntry(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateFinancialEntrySchema)) body: UpdateFinancialEntryInput,
  ) {
    return this.finance.update(user, id, body);
  }

  @Delete("entries/:id")
  removeEntry(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.finance.remove(user, id);
  }
}
