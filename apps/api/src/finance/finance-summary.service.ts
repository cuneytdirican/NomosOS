import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type FinancialEntryType } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/types";
import { endOfDay, parseDateParam, startOfDay } from "../common/dates";
import { assertFinanceAccess, FINANCE_ACCESS } from "./finance-access";
import { dec, formatMoneyTr, fromSum, moneyOut } from "./money";

/**
 * Modül 08 — DETERMİNİSTİK FİNANS ÖZETLERİ.
 *
 * BU DOSYADAKİ HİÇBİR SAYI AI TARAFINDAN ÜRETİLMEZ. `/finance/ask` ucu da dâhil
 * olmak üzere tüm anlatımlar buradaki toplamları ŞABLONA YERLEŞTİREREK kurulur.
 *
 * ────────────────────────── HESAP SÖZLEŞMESİ ──────────────────────────
 * Tüm toplamlar PARA BİRİMİ BAZINDA ayrı tutulur; farklı para birimleri
 * KESİNLİKLE toplanmaz (kur çevrimi yapılmaz — kur alanı henüz şemada yok,
 * uydurma kur kullanmak parasal karar üretmek olurdu).
 *
 *   tahakkuk        = Σ(TAHAKKUK, VEKALET_UCRETI, DANISMANLIK)
 *   tahsilat        = Σ(TAHSILAT)
 *   iade            = Σ(IADE)
 *   netTahsilat     = tahsilat − iade
 *   bekleyen        = tahakkuk − netTahsilat            ← alacak bakiyesi
 *   masraf          = Σ(MASRAF)
 *   harç            = Σ(HARC)
 *   yansıtılabilir  = Σ(MASRAF, HARC | isBillable = true)
 *   avans alınan    = Σ(AVANS)
 *   avans mahsup    = Σ(MASRAF, HARC | isBillable = false)
 *   avans bakiyesi  = avans alınan − avans mahsup
 *
 * Masraf ve harç, "bekleyen"e EKLENMEZ: müvekkile yansıtılan gider faturaya
 * girdiğinde zaten TAHAKKUK olarak finansa döner (bkz. invoices.service.ts →
 * `syncInvoiceAccrual`). İki yerde saymak alacağı şişirirdi.
 *
 * ─────────────────────── TAHSİLAT RİSKİ (kural motoru) ───────────────────────
 * Modül 08, iş kuralı 8. Risk seviyesi KURAL TABANLIDIR; AI yalnızca açıklar.
 *   ortalama gecikme > 60 gün  VEYA  bekleyen/tahakkuk > %40 → YUKSEK
 *   ortalama gecikme > 30 gün  VEYA  bekleyen/tahakkuk > %20 → ORTA
 *   aksi hâlde                                               → DUSUK
 * Ortalama gecikme, VADESİ GEÇMİŞ ve bakiyesi kalan faturaların vade tarihinden
 * bugüne kadar geçen gün sayılarının basit ortalamasıdır.
 */

const ACCRUAL: FinancialEntryType[] = ["TAHAKKUK", "VEKALET_UCRETI", "DANISMANLIK"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Fatura bakiyesi olan (açık) fatura durumları. */
const OPEN_INVOICE_STATUSES = ["GONDERILDI", "KISMI_ODENDI"] as const;

export type RiskBand = "DUSUK" | "ORTA" | "YUKSEK";

interface CurrencyBucket {
  accrued: Prisma.Decimal;
  collected: Prisma.Decimal;
  refunded: Prisma.Decimal;
  expenses: Prisma.Decimal;
  courtFees: Prisma.Decimal;
  billableCosts: Prisma.Decimal;
  advanceReceived: Prisma.Decimal;
  advanceApplied: Prisma.Decimal;
}

interface OpenInvoiceBalance {
  invoiceId: string;
  clientId: string;
  currency: string;
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
  remaining: Prisma.Decimal;
  dueDate: Date | null;
  referenceDate: Date;
  overdueDays: number;
}

function emptyBucket(): CurrencyBucket {
  return {
    accrued: new Prisma.Decimal(0),
    collected: new Prisma.Decimal(0),
    refunded: new Prisma.Decimal(0),
    expenses: new Prisma.Decimal(0),
    courtFees: new Prisma.Decimal(0),
    billableCosts: new Prisma.Decimal(0),
    advanceReceived: new Prisma.Decimal(0),
    advanceApplied: new Prisma.Decimal(0),
  };
}

@Injectable()
export class FinanceSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================================================== MÜVEKKİL ÖZETİ

  /** GET /finance/clients/:clientId/summary */
  async clientSummary(user: AuthUser, clientId: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "müvekkil finans özeti görüntüleme");
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId: user.tenantId },
      select: { id: true, name: true, type: true, taxNumber: true, taxOffice: true },
    });
    if (!client) throw new NotFoundException("Müvekkil bulunamadı.");

    // TEK groupBy ile tüm kırılım: para birimi × tip × faturalanabilirlik.
    const [rows, caseCounts, balances] = await Promise.all([
      this.prisma.client.financialEntry.groupBy({
        by: ["currency", "type", "isBillable"],
        where: { tenantId: user.tenantId, clientId },
        _sum: { amount: true },
      }),
      this.prisma.client.case.groupBy({
        by: ["status"],
        where: { tenantId: user.tenantId, clientId },
        _count: { _all: true },
      }),
      this.openInvoiceBalances(user.tenantId, clientId),
    ]);

    const buckets = this.ensureCurrencies(this.foldBuckets(rows), balances);
    const currencies = this.renderBuckets(buckets);
    const primary = currencies.find((c) => c.currency === "TRY") ?? currencies[0] ?? null;

    const openCaseCount = caseCounts
      .filter((c) => c.status !== "KAPANDI" && c.status !== "ARSIV")
      .reduce((sum, c) => sum + c._count._all, 0);
    const totalCaseCount = caseCounts.reduce((sum, c) => sum + c._count._all, 0);

    const receivables = this.buildAging(balances);
    const risk = this.assessRisk(
      primary ? dec(primary.accrued) : new Prisma.Decimal(0),
      primary ? dec(primary.outstanding) : new Prisma.Decimal(0),
      balances,
    );

    return {
      client,
      openCaseCount,
      totalCaseCount,
      /** Tüm para birimleri; TRY varsa `primary` ondan seçilir. */
      currencies,
      primary,
      receivables,
      risk,
      /** Hesap izinin kendisi — avukat sayının nereden geldiğini görebilmeli. */
      formula: {
        bekleyen: "tahakkuk − (tahsilat − iade)",
        tahakkuk: "TAHAKKUK + VEKALET_UCRETI + DANISMANLIK",
        avansBakiyesi: "AVANS − (yansıtılmayan MASRAF + HARC)",
        not: "Farklı para birimleri toplanmaz; kur çevrimi yapılmaz.",
      },
    };
  }

  // ============================================================ DOSYA ÖZETİ

  /** GET /finance/cases/:caseId/summary */
  async caseSummary(user: AuthUser, caseId: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "dosya finans özeti görüntüleme");
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId },
      select: {
        id: true,
        title: true,
        fileNumber: true,
        status: true,
        client: { select: { id: true, name: true, type: true } },
      },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");

    const [rows, recent, timeAgg] = await Promise.all([
      this.prisma.client.financialEntry.groupBy({
        by: ["currency", "type", "isBillable"],
        where: { tenantId: user.tenantId, caseId },
        _sum: { amount: true },
      }),
      this.prisma.client.financialEntry.findMany({
        where: { tenantId: user.tenantId, caseId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 50,
        select: {
          id: true,
          type: true,
          amount: true,
          currency: true,
          date: true,
          description: true,
          invoiceId: true,
          isBillable: true,
        },
      }),
      this.prisma.client.timeEntry.aggregate({
        where: { tenantId: user.tenantId, caseId },
        _sum: { minutes: true },
        _count: { _all: true },
      }),
    ]);

    const currencies = this.renderBuckets(this.ensureCurrencies(this.foldBuckets(rows), []));
    const totalMinutes = timeAgg._sum.minutes ?? 0;

    return {
      case: found,
      currencies,
      primary: currencies.find((c) => c.currency === "TRY") ?? currencies[0] ?? null,
      time: {
        entryCount: timeAgg._count._all,
        totalMinutes,
        totalHours: new Prisma.Decimal(totalMinutes).div(60).toFixed(2),
      },
      entries: recent.map((e) => ({
        id: e.id,
        type: e.type,
        amount: moneyOut(e.amount),
        amountFormatted: formatMoneyTr(e.amount, e.currency),
        currency: e.currency,
        date: e.date,
        description: e.description,
        invoiceId: e.invoiceId,
        isBillable: e.isBillable,
      })),
    };
  }

  // ============================================================= BÜRO ÖZETİ

  /** GET /finance/summary — büro geneli pano. */
  async officeSummary(user: AuthUser, params: { from?: string; to?: string }) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "büro finans raporu görüntüleme");

    const now = new Date();
    const periodStart = params.from
      ? startOfDay(parseDateParam(params.from, "başlangıç"))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = params.to
      ? endOfDay(parseDateParam(params.to, "bitiş"))
      : endOfDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));

    const [periodRows, allTimeRows, debtorRows, balances, invoiceStatusRows] = await Promise.all([
      this.prisma.client.financialEntry.groupBy({
        by: ["currency", "type", "isBillable"],
        where: { tenantId: user.tenantId, date: { gte: periodStart, lte: periodEnd } },
        _sum: { amount: true },
      }),
      this.prisma.client.financialEntry.groupBy({
        by: ["currency", "type", "isBillable"],
        where: { tenantId: user.tenantId },
        _sum: { amount: true },
      }),
      // En borçlu müvekkiller: tek sorguda müvekkil × para birimi × tip kırılımı.
      this.prisma.client.financialEntry.groupBy({
        by: ["clientId", "currency", "type"],
        where: {
          tenantId: user.tenantId,
          clientId: { not: null },
          type: { in: [...ACCRUAL, "TAHSILAT", "IADE"] },
        },
        _sum: { amount: true },
      }),
      this.openInvoiceBalances(user.tenantId, null),
      this.prisma.client.invoice.groupBy({
        by: ["status", "currency"],
        where: { tenantId: user.tenantId },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);

    const topDebtors = await this.buildTopDebtors(user.tenantId, debtorRows);

    return {
      period: { from: periodStart, to: periodEnd },
      periodTotals: this.renderBuckets(this.ensureCurrencies(this.foldBuckets(periodRows), balances)),
      allTimeTotals: this.renderBuckets(this.ensureCurrencies(this.foldBuckets(allTimeRows), balances)),
      receivables: this.buildAging(balances),
      invoices: invoiceStatusRows.map((r) => ({
        status: r.status,
        currency: r.currency,
        count: r._count._all,
        total: moneyOut(r._sum.total),
      })),
      topDebtors,
      formula: {
        yaslandirma:
          "Açık faturaların (GONDERILDI, KISMI_ODENDI) kalan bakiyesi, vade tarihinden bugüne " +
          "geçen gün sayısına göre kovalara ayrılır. Vadesi belirtilmemiş faturada düzenleme " +
          "tarihi esas alınır.",
        enBorclu:
          "Müvekkil bazında tahakkuk − (tahsilat − iade); yalnızca bakiyesi pozitif olanlar, " +
          "para birimi ayrı ayrı.",
      },
    };
  }

  // ====================================================== ORTAK HESAPLAYICILAR

  /** groupBy satırlarını para birimi bazlı kovaya indirger. */
  private foldBuckets(
    rows: {
      currency: string;
      type: FinancialEntryType;
      isBillable: boolean;
      _sum: { amount: Prisma.Decimal | null };
    }[],
  ): Map<string, CurrencyBucket> {
    const map = new Map<string, CurrencyBucket>();
    for (const row of rows) {
      const bucket = map.get(row.currency) ?? emptyBucket();
      const amount = fromSum(row._sum.amount);

      switch (row.type) {
        case "TAHAKKUK":
        case "VEKALET_UCRETI":
        case "DANISMANLIK":
          bucket.accrued = bucket.accrued.plus(amount);
          break;
        case "TAHSILAT":
          bucket.collected = bucket.collected.plus(amount);
          break;
        case "IADE":
          bucket.refunded = bucket.refunded.plus(amount);
          break;
        case "AVANS":
          bucket.advanceReceived = bucket.advanceReceived.plus(amount);
          break;
        case "MASRAF":
          bucket.expenses = bucket.expenses.plus(amount);
          if (row.isBillable) bucket.billableCosts = bucket.billableCosts.plus(amount);
          else bucket.advanceApplied = bucket.advanceApplied.plus(amount);
          break;
        case "HARC":
          bucket.courtFees = bucket.courtFees.plus(amount);
          if (row.isBillable) bucket.billableCosts = bucket.billableCosts.plus(amount);
          else bucket.advanceApplied = bucket.advanceApplied.plus(amount);
          break;
      }
      map.set(row.currency, bucket);
    }
    return map;
  }

  /**
   * TABAN PARA BİRİMLERİNİ GARANTİLER.
   *
   * Hiç `FinancialEntry` kaydı olmayan bir müvekkilde kova haritası boş kalır ve
   * `primary` null dönerdi; ekran "veri yok" gösterir, oysa açık faturası
   * olabilir. Bu yüzden TRY her zaman, açık faturalarda geçen para birimleri de
   * ayrıca sıfır kovayla eklenir — tutarlar değişmez, yalnızca satır görünür.
   */
  private ensureCurrencies(
    map: Map<string, CurrencyBucket>,
    balances: OpenInvoiceBalance[],
  ): Map<string, CurrencyBucket> {
    for (const currency of ["TRY", ...balances.map((b) => b.currency)]) {
      if (!map.has(currency)) map.set(currency, emptyBucket());
    }
    return map;
  }

  /** Kovaları API yanıtı biçimine çevirir (tüm tutarlar string, kuruş korunur). */
  private renderBuckets(map: Map<string, CurrencyBucket>) {
    return [...map.entries()]
      .sort(([a], [b]) => (a === "TRY" ? -1 : b === "TRY" ? 1 : a.localeCompare(b)))
      .map(([currency, b]) => {
        const netCollected = b.collected.minus(b.refunded);
        const outstanding = b.accrued.minus(netCollected);
        const advanceBalance = b.advanceReceived.minus(b.advanceApplied);
        return {
          currency,
          accrued: moneyOut(b.accrued),
          collected: moneyOut(b.collected),
          refunded: moneyOut(b.refunded),
          netCollected: moneyOut(netCollected),
          outstanding: moneyOut(outstanding),
          expenses: moneyOut(b.expenses),
          courtFees: moneyOut(b.courtFees),
          billableCosts: moneyOut(b.billableCosts),
          advanceReceived: moneyOut(b.advanceReceived),
          advanceApplied: moneyOut(b.advanceApplied),
          advanceBalance: moneyOut(advanceBalance),
          formatted: {
            accrued: formatMoneyTr(b.accrued, currency),
            netCollected: formatMoneyTr(netCollected, currency),
            outstanding: formatMoneyTr(outstanding, currency),
            expenses: formatMoneyTr(b.expenses, currency),
            courtFees: formatMoneyTr(b.courtFees, currency),
            advanceBalance: formatMoneyTr(advanceBalance, currency),
          },
        };
      });
  }

  /**
   * Açık faturaların kalan bakiyeleri.
   *
   * İki sorgu: (1) açık faturalar, (2) `groupBy(invoiceId)` ile ödemeler.
   * Fatura başına ayrı sorgu YAPILMAZ (N+1 önlenir).
   */
  private async openInvoiceBalances(
    tenantId: string,
    clientId: string | null,
  ): Promise<OpenInvoiceBalance[]> {
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        tenantId,
        ...(clientId ? { clientId } : {}),
        status: { in: [...OPEN_INVOICE_STATUSES] },
      },
      select: {
        id: true,
        clientId: true,
        currency: true,
        total: true,
        dueDate: true,
        issueDate: true,
      },
    });
    if (invoices.length === 0) return [];

    const paidRows = await this.prisma.client.payment.groupBy({
      by: ["invoiceId"],
      where: { tenantId, invoiceId: { in: invoices.map((i) => i.id) } },
      _sum: { amount: true },
    });
    const paidMap = new Map<string, Prisma.Decimal>();
    for (const row of paidRows) {
      if (row.invoiceId) paidMap.set(row.invoiceId, fromSum(row._sum.amount));
    }

    const today = startOfDay(new Date()).getTime();
    return invoices.map((inv) => {
      const paid = paidMap.get(inv.id) ?? new Prisma.Decimal(0);
      const remaining = dec(inv.total).minus(paid);
      const referenceDate = inv.dueDate ?? inv.issueDate;
      const overdueDays = Math.max(
        0,
        Math.floor((today - startOfDay(referenceDate).getTime()) / MS_PER_DAY),
      );
      return {
        invoiceId: inv.id,
        clientId: inv.clientId,
        currency: inv.currency,
        total: dec(inv.total),
        paid,
        remaining,
        dueDate: inv.dueDate,
        referenceDate,
        overdueDays: inv.dueDate ? overdueDays : 0,
      };
    });
  }

  /** Yaşlandırma kovaları — para birimi bazında. */
  private buildAging(balances: OpenInvoiceBalance[]) {
    const byCurrency = new Map<
      string,
      { notDue: Prisma.Decimal; d0_30: Prisma.Decimal; d31_60: Prisma.Decimal; d61_90: Prisma.Decimal; d90plus: Prisma.Decimal; total: Prisma.Decimal; count: number }
    >();

    for (const b of balances) {
      if (b.remaining.lte(0)) continue;
      const bucket =
        byCurrency.get(b.currency) ??
        {
          notDue: new Prisma.Decimal(0),
          d0_30: new Prisma.Decimal(0),
          d31_60: new Prisma.Decimal(0),
          d61_90: new Prisma.Decimal(0),
          d90plus: new Prisma.Decimal(0),
          total: new Prisma.Decimal(0),
          count: 0,
        };

      const notYetDue = b.dueDate !== null && b.dueDate.getTime() > startOfDay(new Date()).getTime();
      if (notYetDue) bucket.notDue = bucket.notDue.plus(b.remaining);
      else if (b.overdueDays <= 30) bucket.d0_30 = bucket.d0_30.plus(b.remaining);
      else if (b.overdueDays <= 60) bucket.d31_60 = bucket.d31_60.plus(b.remaining);
      else if (b.overdueDays <= 90) bucket.d61_90 = bucket.d61_90.plus(b.remaining);
      else bucket.d90plus = bucket.d90plus.plus(b.remaining);

      bucket.total = bucket.total.plus(b.remaining);
      bucket.count += 1;
      byCurrency.set(b.currency, bucket);
    }

    const overdue = balances.filter((b) => b.remaining.gt(0) && b.overdueDays > 0);
    const oldestOverdueDays = overdue.reduce((max, b) => Math.max(max, b.overdueDays), 0);

    return {
      openInvoiceCount: balances.filter((b) => b.remaining.gt(0)).length,
      overdueInvoiceCount: overdue.length,
      oldestOverdueDays,
      averageOverdueDays: overdue.length
        ? Math.round(overdue.reduce((sum, b) => sum + b.overdueDays, 0) / overdue.length)
        : 0,
      aging: [...byCurrency.entries()].map(([currency, b]) => ({
        currency,
        invoiceCount: b.count,
        notDue: moneyOut(b.notDue),
        "0-30": moneyOut(b.d0_30),
        "31-60": moneyOut(b.d31_60),
        "61-90": moneyOut(b.d61_90),
        "90+": moneyOut(b.d90plus),
        total: moneyOut(b.total),
      })),
    };
  }

  /**
   * TAHSİLAT RİSKİ — KURAL MOTORU (Modül 08, iş kuralı 8).
   * AI bu bandı DEĞİŞTİREMEZ; yalnızca `reasons` metnini insan diline çevirir.
   */
  private assessRisk(
    accrued: Prisma.Decimal,
    outstanding: Prisma.Decimal,
    balances: OpenInvoiceBalance[],
  ): { band: RiskBand; reasons: string[]; outstandingRatioPercent: string; averageOverdueDays: number; rule: string } {
    const overdue = balances.filter((b) => b.remaining.gt(0) && b.overdueDays > 0);
    const averageOverdueDays = overdue.length
      ? Math.round(overdue.reduce((sum, b) => sum + b.overdueDays, 0) / overdue.length)
      : 0;

    const ratio = accrued.gt(0)
      ? outstanding.div(accrued).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : new Prisma.Decimal(0);

    const reasons: string[] = [];
    let band: RiskBand = "DUSUK";

    if (averageOverdueDays > 60 || ratio.gt(40)) {
      band = "YUKSEK";
    } else if (averageOverdueDays > 30 || ratio.gt(20)) {
      band = "ORTA";
    }

    if (averageOverdueDays > 0) {
      reasons.push(
        `Vadesi geçmiş ${overdue.length} fatura var; ortalama gecikme ${averageOverdueDays} gün.`,
      );
    }
    if (accrued.gt(0)) {
      reasons.push(`Bekleyen bakiye, toplam tahakkukun %${ratio.toFixed(2)}'si kadar.`);
    } else {
      reasons.push("Bu müvekkil için henüz tahakkuk kaydı yok; oran hesaplanamadı.");
    }

    return {
      band,
      reasons,
      outstandingRatioPercent: ratio.toFixed(2),
      averageOverdueDays,
      rule: "ort. gecikme > 60 gün veya bekleyen/tahakkuk > %40 → YUKSEK; > 30 gün veya > %20 → ORTA; aksi DUSUK.",
    };
  }

  /** En çok borcu olan 10 müvekkil (para birimi bazında, bakiyesi pozitif olanlar). */
  private async buildTopDebtors(
    tenantId: string,
    rows: {
      clientId: string | null;
      currency: string;
      type: FinancialEntryType;
      _sum: { amount: Prisma.Decimal | null };
    }[],
  ) {
    const map = new Map<string, { clientId: string; currency: string; balance: Prisma.Decimal }>();
    for (const row of rows) {
      if (!row.clientId) continue;
      const key = `${row.clientId}|${row.currency}`;
      const entry = map.get(key) ?? {
        clientId: row.clientId,
        currency: row.currency,
        balance: new Prisma.Decimal(0),
      };
      const amount = fromSum(row._sum.amount);
      if (ACCRUAL.includes(row.type)) entry.balance = entry.balance.plus(amount);
      else if (row.type === "TAHSILAT") entry.balance = entry.balance.minus(amount);
      else if (row.type === "IADE") entry.balance = entry.balance.plus(amount);
      map.set(key, entry);
    }

    const ranked = [...map.values()]
      .filter((e) => e.balance.gt(0))
      .sort((a, b) => b.balance.comparedTo(a.balance))
      .slice(0, 10);
    if (ranked.length === 0) return [];

    const clients = await this.prisma.client.client.findMany({
      where: { tenantId, id: { in: [...new Set(ranked.map((r) => r.clientId))] } },
      select: { id: true, name: true, type: true },
    });
    const nameMap = new Map(clients.map((c) => [c.id, c]));

    return ranked.map((r) => ({
      clientId: r.clientId,
      client: nameMap.get(r.clientId) ?? null,
      currency: r.currency,
      outstanding: moneyOut(r.balance),
      outstandingFormatted: formatMoneyTr(r.balance, r.currency),
    }));
  }
}
