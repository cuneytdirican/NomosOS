/**
 * DOSYA GİDERLERİ (geliştirme planı A1) — dosyanın GERÇEK maliyeti.
 *
 * NEDEN VAR: yalnız fatura ve zaman kaydı vardı; harç, bilirkişi ücreti,
 * tebligat ve yol/danışma gideri hiçbir yerde tutulmuyordu. Dosya kapatma
 * hesabı ve İİK m.202 gider avansı iadesi bu yüzden HESAPLANAMIYORDU.
 *
 * SİLME YOK: gider kaydı düzeltmeyle (PATCH) değiştirilir; mali denetim izi
 * için silme ucu yayımlanmaz (fatura deseni).
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
// Gider girişi FINANS beyaz listesiyle aynı kapıdadır (masraf/tahsilat deseni).
const FINANS_YAZMA = ROLE_SETS.FINANS;
import type { AuthUser } from "../common/types";

export const EXPENSE_CATEGORIES = ["HARC", "BILIRKISI", "TEBLIGAT", "YOL_DANISMA", "DIGER"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  HARC: "Harç",
  BILIRKISI: "Bilirkişi",
  TEBLIGAT: "Tebligat",
  YOL_DANISMA: "Yol / Danışma",
  DIGER: "Diğer",
};

@Injectable()
export class CaseExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Dosya giderleri + özet (toplam/ödenmiş/iade edilebilir İİK m.202). */
  async listForCase(user: AuthUser, caseId: string) {
    await this.requireCase(user.tenantId, caseId);
    const expenses = await this.prisma.client.caseExpense.findMany({
      where: { tenantId: user.tenantId, caseId },
      orderBy: { spentAt: "desc" },
    });
    const summary = this.summarize(expenses);
    return { expenses, summary };
  }

  /** Büro geneli gider listesi (raporlama; dosya süzgeci opsiyonel). */
  async listAll(user: AuthUser, filters: { caseId?: string; category?: string; from?: string; to?: string }) {
    const where: Prisma.CaseExpenseWhereInput = {
      tenantId: user.tenantId,
      ...(filters.caseId ? { caseId: filters.caseId } : {}),
      ...(filters.category && (EXPENSE_CATEGORIES as readonly string[]).includes(filters.category)
        ? { category: filters.category }
        : {}),
      ...(filters.from || filters.to
        ? {
            spentAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.client.caseExpense.findMany({
      where,
      orderBy: { spentAt: "desc" },
      take: 500,
      include: { case: { select: { id: true, title: true, fileNumber: true } } },
    });
    return { expenses: rows, summary: this.summarize(rows) };
  }

  async create(
    user: AuthUser,
    caseId: string,
    input: {
      category: string;
      title: string;
      amount: number;
      spentAt: string | Date;
      paidAt?: string | Date | null;
      paidFrom?: string;
      refundable?: boolean;
      note?: string;
    },
  ) {
    assertRole(user, FINANS_YAZMA, "dosya gideri girişi");
    await this.requireCase(user.tenantId, caseId);
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) {
      throw new BadRequestException("Geçersiz gider türü.");
    }
    if (!(input.amount > 0)) {
      throw new BadRequestException("Gider tutarı sıfırdan büyük olmalıdır.");
    }
    // Kuruş hassasiyeti: yüzüncük haneden fazla hane reddedilir.
    const rounded = Math.round(input.amount * 100) / 100;
    if (rounded !== input.amount) {
      throw new BadRequestException("Gider tutarı en fazla iki ondalık basamak içerebilir (kuruş).");
    }
    const created = await this.prisma.client.caseExpense.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        category: input.category,
        title: input.title.trim(),
        amount: new Prisma.Decimal(rounded.toFixed(2)),
        spentAt: input.spentAt instanceof Date ? input.spentAt : new Date(input.spentAt),
        paidAt: input.paidAt === null || input.paidAt === undefined ? null : new Date(input.paidAt),
        paidFrom: input.paidFrom === "BURO" ? "BURO" : "AVANS",
        refundable: input.refundable ?? true,
        note: input.note?.trim() || null,
        createdBy: user.userId,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_EXPENSE_CREATE",
      entity: "CaseExpense",
      entityId: created.id,
      detail: `${caseId} · ${input.title} · ${rounded.toFixed(2)} TL`,
    });
    return created;
  }

  /** Düzeltme: tutar/tür/ödurum güncellenir — kayıt SİLİNMEZ. */
  async update(
    user: AuthUser,
    id: string,
    input: {
      category?: string;
      title?: string;
      amount?: number;
      spentAt?: string | Date;
      paidAt?: string | Date | null;
      paidFrom?: string;
      refundable?: boolean;
      note?: string | null;
    },
  ) {
    assertRole(user, FINANS_YAZMA, "dosya gideri düzeltme");
    const existing = await this.prisma.client.caseExpense.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException("Gider kaydı bulunamadı.");
    if (input.category && !(EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) {
      throw new BadRequestException("Geçersiz gider türü.");
    }
    if (input.amount !== undefined && !(input.amount > 0)) {
      throw new BadRequestException("Gider tutarı sıfırdan büyük olmalıdır.");
    }
    const updated = await this.prisma.client.caseExpense.update({
      where: { id },
      data: {
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.amount !== undefined
          ? { amount: new Prisma.Decimal((Math.round(input.amount * 100) / 100).toFixed(2)) }
          : {}),
        ...(input.spentAt !== undefined
          ? { spentAt: input.spentAt instanceof Date ? input.spentAt : new Date(input.spentAt) }
          : {}),
        ...(input.paidAt !== undefined
          ? {
              paidAt: input.paidAt === null || input.paidAt === undefined ? null : new Date(input.paidAt),
            }
          : {}),
        ...(input.paidFrom !== undefined ? { paidFrom: input.paidFrom === "BURO" ? "BURO" : "AVANS" } : {}),
        ...(input.refundable !== undefined ? { refundable: input.refundable } : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASE_EXPENSE_UPDATE",
      entity: "CaseExpense",
      entityId: id,
      detail: `${existing.title}: ${existing.amount} → ${updated.amount} TL`,
    });
    return updated;
  }

  /** Ödeme işaretle — avans/kasa ayrımı korunur. */
  async markPaid(user: AuthUser, id: string, paidFrom: "AVANS" | "BURO") {
    assertRole(user, FINANS_YAZMA, "gider ödeme işaretleme");
    const existing = await this.prisma.client.caseExpense.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException("Gider kaydı bulunamadı.");
    const updated = await this.prisma.client.caseExpense.update({
      where: { id },
      data: { paidAt: new Date(), paidFrom },
    });
    return updated;
  }

  /**
   * DOSYA KAPATMA HESABI — İİK m.202 gider avansı iadesi.
   *
   * Toplam gider, ödenmiş/kalan, iade edilebilir kalemler (refundable) ve
   * avanstan yapılan ödemelerin müvekkile iade özeti.
   */
  async closingStatement(user: AuthUser, caseId: string) {
    await this.requireCase(user.tenantId, caseId);
    const expenses = await this.prisma.client.caseExpense.findMany({
      where: { tenantId: user.tenantId, caseId },
      orderBy: { spentAt: "asc" },
    });
    const summary = this.summarize(expenses);
    const refundableItems = expenses.filter((e) => e.refundable);
    const refundTotal = refundableItems.reduce((acc, e) => acc.plus(e.amount), new Prisma.Decimal(0));
    return {
      caseId,
      ...summary,
      // İİK m.202: gider avansından yapılan ve iade edilebilir ödemeler.
      refundableCount: refundableItems.length,
      refundableTotal: refundTotal.toString(),
      refundableItems: refundableItems.map((e) => ({
        id: e.id,
        title: e.title,
        category: e.category,
        amount: e.amount.toString(),
        spentAt: e.spentAt,
        paidFrom: e.paidFrom,
      })),
      note:
        "İİK m.202: tahsil edilen gider avansının kullanılmayan kısmı, geri verilmesi istenildiği anda iade edilir. " +
        "İade edilebilir işaretli kalemler bu kapsamdadır; 'refundable' işaretini kalem kartından değiştirebilirsiniz.",
    };
  }

  private summarize(
    expenses: Array<{
      amount: Prisma.Decimal;
      paidAt: Date | null;
      refundable: boolean;
    }>,
  ) {
    let total = new Prisma.Decimal(0);
    let paid = new Prisma.Decimal(0);
    let unpaid = new Prisma.Decimal(0);
    for (const e of expenses) {
      total = total.plus(e.amount);
      if (e.paidAt !== null) paid = paid.plus(e.amount);
      else unpaid = unpaid.plus(e.amount);
    }
    return {
      count: expenses.length,
      total: total.toString(),
      paid: paid.toString(),
      unpaid: unpaid.toString(),
    };
  }

  private async requireCase(tenantId: string, caseId: string) {
    const c = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException("Dosya bulunamadı.");
  }
}
