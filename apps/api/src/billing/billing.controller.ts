import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { FeeAgreementsService } from "./fee-agreements.service";
import { TimeEntriesService } from "./time-entries.service";
import { InvoicesService } from "./invoices.service";
import { PaymentsService } from "./payments.service";
import {
  cancelInvoiceSchema,
  createFeeAgreementSchema,
  createInvoiceSchema,
  createPaymentSchema,
  createTimeEntrySchema,
  finalizeInvoiceSchema,
  invoiceFromTimeEntriesSchema,
  updateFeeAgreementSchema,
  updateInvoiceSchema,
  updateTimeEntrySchema,
  type CancelInvoiceInput,
  type CreateFeeAgreementInput,
  type CreateInvoiceInput,
  type CreatePaymentInput,
  type CreateTimeEntryInput,
  type FinalizeInvoiceInput,
  type InvoiceFromTimeEntriesInput,
  type UpdateFeeAgreementInput,
  type UpdateInvoiceInput,
  type UpdateTimeEntryInput,
} from "./billing.dto";

/**
 * Modül 09 — Faturalama uçları (`/api/v1/billing`).
 *
 * YOL SIRASI ÖNEMLİ: sabit alt yollar (`.../summary`, `.../from-time-entries`)
 * `:id` yakalayan yollardan ÖNCE tanımlanır.
 *
 * Rol kapıları servis katmanındadır (`finance-access.ts`).
 */
@Controller("billing")
export class BillingController {
  constructor(
    private readonly agreements: FeeAgreementsService,
    private readonly timeEntries: TimeEntriesService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
  ) {}

  // =================================================== ÜCRET SÖZLEŞMELERİ

  @Get("fee-agreements")
  listAgreements(
    @CurrentUser() user: AuthUser,
    @Query("clientId") clientId?: string,
    @Query("caseId") caseId?: string,
    @Query("type") type?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.agreements.list(user, { clientId, caseId, type, status, page, limit });
  }

  @Post("fee-agreements")
  createAgreement(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFeeAgreementSchema)) body: CreateFeeAgreementInput,
  ) {
    return this.agreements.create(user, body);
  }

  @Get("fee-agreements/:id")
  agreementDetail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.agreements.detail(user, id);
  }

  @Patch("fee-agreements/:id")
  updateAgreement(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateFeeAgreementSchema)) body: UpdateFeeAgreementInput,
  ) {
    return this.agreements.update(user, id, body);
  }

  @Delete("fee-agreements/:id")
  removeAgreement(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.agreements.remove(user, id);
  }

  // ========================================================= ZAMAN KAYITLARI

  /** Sabit yol — `:id` yollarından önce. */
  @Get("time-entries/summary")
  timeSummary(
    @CurrentUser() user: AuthUser,
    @Query("userId") userId?: string,
    @Query("caseId") caseId?: string,
    @Query("clientId") clientId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("billable") billable?: string,
    @Query("uninvoiced") uninvoiced?: string,
  ) {
    return this.timeEntries.summary(user, { userId, caseId, clientId, from, to, billable, uninvoiced });
  }

  @Get("time-entries")
  listTimeEntries(
    @CurrentUser() user: AuthUser,
    @Query("userId") userId?: string,
    @Query("caseId") caseId?: string,
    @Query("clientId") clientId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("billable") billable?: string,
    @Query("uninvoiced") uninvoiced?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.timeEntries.list(user, {
      userId,
      caseId,
      clientId,
      from,
      to,
      billable,
      uninvoiced,
      page,
      limit,
    });
  }

  @Post("time-entries")
  createTimeEntry(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTimeEntrySchema)) body: CreateTimeEntryInput,
  ) {
    return this.timeEntries.create(user, body);
  }

  @Patch("time-entries/:id")
  updateTimeEntry(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTimeEntrySchema)) body: UpdateTimeEntryInput,
  ) {
    return this.timeEntries.update(user, id, body);
  }

  @Delete("time-entries/:id")
  removeTimeEntry(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.timeEntries.remove(user, id);
  }

  // ================================================================ e-FATURA
  // Sabit yollar — `invoices/:id` kalıbına düşmemeleri için önce tanımlanır.

  /** GET /billing/e-invoice/provider — sağlayıcı durumu (kimlik bilgisi İÇERMEZ). */
  @Get("e-invoice/provider")
  eInvoiceProvider(@CurrentUser() user: AuthUser) {
    return this.invoices.describeProvider(user);
  }

  /** GET /billing/taxpayer-check?vkn=1234567890 */
  @Get("taxpayer-check")
  taxpayerCheck(@CurrentUser() user: AuthUser, @Query("vkn") vkn: string) {
    return this.invoices.checkTaxpayer(user, vkn);
  }

  // ================================================================ FATURALAR

  @Get("invoices")
  listInvoices(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("clientId") clientId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.invoices.list(user, { status, clientId, from, to, page, limit });
  }

  /** Sabit yol — `invoices/:id` kalıbından önce. */
  @Post("invoices/from-time-entries")
  createInvoiceFromTime(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(invoiceFromTimeEntriesSchema)) body: InvoiceFromTimeEntriesInput,
  ) {
    return this.invoices.createFromTimeEntries(user, body);
  }

  @Post("invoices")
  createInvoice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: CreateInvoiceInput,
  ) {
    return this.invoices.create(user, body);
  }

  @Get("invoices/:id")
  invoiceDetail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.invoices.detail(user, id);
  }

  @Patch("invoices/:id")
  updateInvoice(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateInvoiceSchema)) body: UpdateInvoiceInput,
  ) {
    return this.invoices.update(user, id, body);
  }

  @Delete("invoices/:id")
  removeInvoice(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.invoices.remove(user, id);
  }

  /** TASLAK → GONDERILDI; numara bu anda atanır. */
  @Post("invoices/:id/finalize")
  finalizeInvoice(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(finalizeInvoiceSchema)) body: FinalizeInvoiceInput,
  ) {
    return this.invoices.finalize(user, id, body);
  }

  @Post("invoices/:id/cancel")
  cancelInvoice(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelInvoiceSchema)) body: CancelInvoiceInput,
  ) {
    return this.invoices.cancel(user, id, body);
  }

  /** Yapılandırılmamış entegratörde 503 döner ve fatura DEĞİŞMEZ. */
  @Post("invoices/:id/e-invoice/send")
  sendEInvoice(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.invoices.sendEInvoice(user, id);
  }

  /**
   * GET /billing/invoices/:id/e-invoice/status — BEKLIYOR mutabakat yolu (İ-32).
   * GİB'ten dönen gerçek durumu yerel kayda yansıtır; çift gönderim gerektirmez.
   */
  @Get("invoices/:id/e-invoice/status")
  reconcileEInvoiceStatus(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.invoices.reconcileEInvoiceStatus(user, id);
  }

  /** A6 (rakip analizi) — e-SMM (Serbest Meslek Makbuzu) gönderimi. */
  @Post("invoices/:id/e-smm/send")
  sendESmm(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.invoices.sendESmm(user, id);
  }

  // ================================================================ ÖDEMELER

  @Get("payments")
  listPayments(
    @CurrentUser() user: AuthUser,
    @Query("clientId") clientId?: string,
    @Query("invoiceId") invoiceId?: string,
    @Query("method") method?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.payments.list(user, { clientId, invoiceId, method, from, to, page, limit });
  }

  @Post("payments")
  createPayment(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPaymentSchema)) body: CreatePaymentInput,
  ) {
    return this.payments.create(user, body);
  }

  @Delete("payments/:id")
  removePayment(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.payments.remove(user, id);
  }
}
