/**
 * DOSYA GİDERLERİ UÇLARI.
 *
 * GET   /case-expenses?caseId=&category=&from=&to=  — büro geneli (süzeltilmiş)
 * GET   /cases/:caseId/case-expenses                — dosya giderleri + özet
 * GET   /cases/:caseId/case-expenses/closing         — İİK m.202 kapatma hesabı
 * POST  /cases/:caseId/case-expenses                — gider ekle
 * PATCH /case-expenses/:id                           — düzeltme (silme ucu YOKTUR)
 * POST  /case-expenses/:id/mark-paid                 — ödeme işaretle
 */

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { CaseExpensesService, EXPENSE_CATEGORIES } from "./case-expenses.service";

const createSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, { errorMap: () => ({ message: "Geçersiz gider türü." }) }),
  title: z.string().trim().min(2, "Başlık en az 2 karakter olmalıdır.").max(200),
  amount: z
    .number({ invalid_type_error: "Tutar sayı olmalıdır." })
    .positive("Tutar sıfırdan büyük olmalıdır.")
    .refine((n) => Math.round(n * 100) === n * 100, "Tutar en fazla iki ondalık basamak içerebilir (kuruş)."),
  spentAt: z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }),
  paidAt: z.coerce.date().nullable().optional(),
  paidFrom: z.enum(["AVANS", "BURO"]).optional(),
  refundable: z.boolean().optional(),
  note: z.string().trim().max(1000).optional(),
});
export type CreateExpenseInput = z.infer<typeof createSchema>;

const updateSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    title: z.string().trim().min(2).max(200).optional(),
    amount: z
      .number()
      .positive("Tutar sıfırdan büyük olmalıdır.")
      .refine((n) => Math.round(n * 100) === n * 100, "Tutar en fazla iki ondalık basamak içerebilir.")
      .optional(),
    spentAt: z.coerce.date().optional(),
    paidAt: z.coerce.date().nullable().optional(),
    paidFrom: z.enum(["AVANS", "BURO"]).optional(),
    refundable: z.boolean().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateExpenseInput = z.infer<typeof updateSchema>;

const markPaidSchema = z.object({ paidFrom: z.enum(["AVANS", "BURO"]) });

@Controller("case-expenses")
export class CaseExpensesController {
  constructor(private readonly expenses: CaseExpensesService) {}

  /** Büro geneli gider listesi — raporlama/süzme. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("caseId") caseId?: string,
    @Query("category") category?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.expenses.listAll(user, { caseId, category, from, to });
  }

  @Get(":id/closing")
  closing(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    // id burada caseId'dir: POST /cases/:caseId/case-expenses/closing da buraya
    // düşmez; aşağıdaki Case-scoped denetleyici ayrıca vardır.
    return this.expenses.closingStatement(user, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateExpenseInput,
  ) {
    return this.expenses.update(user, id, body);
  }

  @Post(":id/mark-paid")
  @HttpCode(200)
  markPaid(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(markPaidSchema)) body: { paidFrom: "AVANS" | "BURO" },
  ) {
    return this.expenses.markPaid(user, id, body.paidFrom);
  }
}

/** Dosya kapsamlı uçlar — /cases/:caseId/case-expenses. */
@Controller("cases/:caseId/case-expenses")
export class CaseScopedExpensesController {
  constructor(private readonly expenses: CaseExpensesService) {}

  @Get()
  listForCase(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.expenses.listForCase(user, caseId);
  }

  @Get("closing")
  closing(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.expenses.closingStatement(user, caseId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(createSchema)) body: CreateExpenseInput,
  ) {
    return this.expenses.create(user, caseId, body);
  }
}
