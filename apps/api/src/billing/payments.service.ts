import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PaymentMethod } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { paged, resolvePage } from "../common/pagination";
import { endOfDay, parseDateParam, startOfDay } from "../common/dates";
import { assertFinanceAccess, FINANCE_ACCESS } from "../finance/finance-access";
import { dec, formatMoneyTr, moneyOut } from "../finance/money";
import { PAYMENT_METHODS, type CreatePaymentInput } from "./billing.dto";
import { AUTO_COLLECTION_MARKER, InvoicesService } from "./invoices.service";

const PAYMENT_INCLUDE = {
  client: { select: { id: true, name: true } },
  invoice: { select: { id: true, invoiceNo: true, total: true, currency: true, status: true } },
} satisfies Prisma.PaymentInclude;

type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

export interface PaymentListParams {
  clientId?: string;
  invoiceId?: string;
  method?: string;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
}

/**
 * Modül 09 — Ödemeler (müvekkil tahsilatı).
 *
 * TEK İŞLEMDE ÜÇ ETKİ (Modül 09, iş kuralı 7):
 *   1. `Payment` kaydı yazılır.
 *   2. Faturanın ödeme durumu YENİDEN HESAPLANIR
 *      (kısmi → KISMI_ODENDI, tam → ODENDI) — durum istemciden gelmez.
 *   3. Finans modülüne `FinancialEntry(TAHSILAT)` yazılır ki müvekkil bakiyesi
 *      anında düşsün. Bu kayıt `[OTO-TAHSILAT]` imzasını taşır ve ödeme
 *      silinince birlikte silinir; kullanıcının elle girdiği tahsilatlarla
 *      karışmaz.
 *
 * FAZLA ÖDEME: reddedilmez ama SESSİZ DE GEÇİLMEZ. Varsayılan olarak 400 ile
 * uyarılır ve kullanıcıya iki seçenek sunulur: tutarı düzeltmek ya da
 * `allowOverpayment: true` ile bilerek kabul etmek. Kabul edilirse yanıt
 * `overpayment` alanıyla döner ve fark AVANS olarak değerlendirilmelidir.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  async list(user: AuthUser, params: PaymentListParams) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "tahsilatları görüntüleme");
    const pageParams = resolvePage(params);
    const where: Prisma.PaymentWhereInput = { tenantId: user.tenantId };

    if (params.clientId) where.clientId = params.clientId;
    if (params.invoiceId) where.invoiceId = params.invoiceId;
    if (params.method) {
      if (!(PAYMENT_METHODS as readonly string[]).includes(params.method)) {
        throw new BadRequestException("Geçersiz ödeme yöntemi.");
      }
      where.method = params.method as PaymentMethod;
    }
    if (params.from || params.to) {
      where.date = {
        ...(params.from ? { gte: startOfDay(parseDateParam(params.from, "başlangıç")) } : {}),
        ...(params.to ? { lte: endOfDay(parseDateParam(params.to, "bitiş")) } : {}),
      };
    }

    const [items, total, agg] = await Promise.all([
      this.prisma.client.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.payment.count({ where }),
      this.prisma.client.payment.groupBy({ by: ["method"], where, _sum: { amount: true } }),
    ]);

    return {
      ...paged(items.map((p) => this.serialize(p)), total, pageParams),
      byMethod: agg.map((row) => ({
        method: row.method,
        amount: moneyOut(row._sum.amount),
      })),
    };
  }

  async create(user: AuthUser, input: CreatePaymentInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.PAYMENT_WRITE, "tahsilat kaydı girme");
    const client = await this.requireClient(user.tenantId, input.clientId);
    const amount = dec(input.amount);

    /**
     * FAZLA ÖDEME KONTROLÜ YAZMA İŞLEMİYLE AYNI TRANSACTION'DADIR.
     *
     * Eskiden `alreadyPaid` toplaması ve `amount.gt(remaining)` kapısı
     * transaction'ın DIŞINDAYDI (denetim bulgusu 4). İki eşzamanlı
     * `POST /billing/payments` isteği aynı `remaining` değerini okuyor, ikisi
     * de kapıdan geçiyor ve ikisi de yazıyordu: 100.000 TL'lik faturaya iki kez
     * 100.000 TL tahsilat kaydedilebiliyordu. `recalcPaymentStatus` sonradan
     * ODENDI + `overpaid: 100.000` üretiyor, ama kullanıcı `allowOverpayment`
     * onayını HİÇ vermemiş ve 400 uyarısını HİÇ görmemiş oluyordu.
     *
     * Parasal eşik kontrolü, kontrolü besleyen veriyi kilitleyen aynı
     * transaction içinde olmak zorundadır. Fatura satırı `FOR UPDATE` ile
     * kilitlenir; ikinci istek birincinin yazması bitene kadar bekler ve
     * GÜNCEL bakiyeyi okur.
     */
    const result = await this.prisma.client.$transaction(async (tx) => {
      // Ö-14: para birimi artık KAYDIN KENDİ ALANIDIR. Serbest tahsilatta
      // çağıranın belirttiği değer, belirtmediyse TRY kullanılır; faturaya bağlı
      // tahsilatta faturanınki ESAS ALINIR ve çağıran farklı bir değer
      // gönderdiyse istek reddedilir (sessizce ezmek, para birimini yanlış
      // kaydetmenin en sinsi yoludur).
      let currency = input.currency ?? "TRY";
      if (input.invoiceId) {
        // Fatura satırını kilitle — bakiye okuması bu kilidin arkasında yapılır.
        await tx.$executeRaw`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} AND "tenantId" = ${user.tenantId} FOR UPDATE`;

        const invoice = await tx.invoice.findFirst({
          where: { id: input.invoiceId, tenantId: user.tenantId },
          select: { id: true, clientId: true, status: true, total: true, currency: true, invoiceNo: true },
        });
        if (!invoice) throw new BadRequestException("Fatura bulunamadı.");
        if (invoice.clientId !== input.clientId) {
          throw new BadRequestException("Seçilen fatura bu müvekkile ait değil.");
        }
        if (invoice.status === "TASLAK") {
          throw new ConflictException(
            "Taslak faturaya tahsilat kaydedilemez. Önce faturayı kesinleştirin.",
          );
        }
        if (invoice.status === "IPTAL") {
          throw new ConflictException("İptal edilmiş faturaya tahsilat kaydedilemez.");
        }
        if (input.currency && input.currency !== invoice.currency) {
          throw new BadRequestException(
            `Tahsilatın para birimi (${input.currency}) faturanın para biriminden ` +
              `(${invoice.currency}) farklı. Kur çevrimi yapılmaz; ya tutarı fatura para ` +
              "biriminde girin ya da bu tahsilatı faturaya bağlamadan serbest tahsilat olarak kaydedin.",
          );
        }
        currency = invoice.currency;

        const paidAgg = await tx.payment.aggregate({
          where: { tenantId: user.tenantId, invoiceId: invoice.id },
          _sum: { amount: true },
        });
        const alreadyPaid = paidAgg._sum.amount ?? new Prisma.Decimal(0);
        const remaining = dec(invoice.total).minus(alreadyPaid);

        if (amount.gt(remaining) && !input.allowOverpayment) {
          throw new BadRequestException({
            message:
              `Tahsilat tutarı faturanın kalan bakiyesini aşıyor. Kalan bakiye ` +
              `${formatMoneyTr(remaining, currency)}, girilen tutar ${formatMoneyTr(amount, currency)}. ` +
              "Tutarı düzeltin ya da farkı bilerek avans olarak kabul etmek için " +
              "`allowOverpayment: true` gönderin.",
            invoiceTotal: moneyOut(invoice.total),
            alreadyPaid: moneyOut(alreadyPaid),
            remaining: moneyOut(remaining),
            overpaymentAmount: moneyOut(amount.minus(remaining)),
          });
        }
      }

      const payment = await tx.payment.create({
        data: {
          tenantId: user.tenantId,
          invoiceId: input.invoiceId ?? null,
          clientId: input.clientId,
          amount,
          currency,
          date: input.date,
          method: input.method as PaymentMethod,
          reference: input.reference ?? null,
          note: input.note ?? null,
          createdBy: user.userId,
        },
        include: PAYMENT_INCLUDE,
      });

      // FİNANS MUTABAKATI — müvekkil bakiyesi anında düşsün.
      await tx.financialEntry.create({
        data: {
          tenantId: user.tenantId,
          clientId: input.clientId,
          type: "TAHSILAT",
          amount,
          // Ö-14: artık kaydın kendi para birimi kullanılır; `payment.invoice`
          // yoksa koşulsuz "TRY" varsayımına düşülmez.
          currency: payment.currency,
          date: input.date,
          description:
            `${AUTO_COLLECTION_MARKER}:${payment.id} ` +
            `${payment.invoice?.invoiceNo ? `${payment.invoice.invoiceNo} numaralı fatura tahsilatı` : "Serbest tahsilat"}` +
            `${input.reference ? ` (${input.reference})` : ""}`,
          invoiceId: input.invoiceId ?? null,
          isBillable: false,
        },
      });

      const reconciliation = input.invoiceId
        ? await this.invoices.recalcPaymentStatus(tx, user.tenantId, input.invoiceId)
        : null;

      // Para birimi transaction içinde (kilidin arkasında) çözülür; dışarıdaki
      // mesajlar da aynı değeri kullansın diye sonuçla birlikte döner.
      return { payment, reconciliation, currency };
    });
    const currency = result.currency;

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PAYMENT_CREATE",
      entity: "Payment",
      entityId: result.payment.id,
      detail:
        `${client.name} — ${formatMoneyTr(amount, currency)} (${input.method})` +
        `${result.reconciliation ? ` · fatura durumu: ${result.reconciliation.status}` : ""}`,
    });

    return {
      ...this.serialize(result.payment),
      invoiceStatus: result.reconciliation?.status ?? null,
      invoiceRemaining: result.reconciliation ? moneyOut(result.reconciliation.remaining) : null,
      overpayment:
        result.reconciliation && result.reconciliation.overpaid.gt(0)
          ? {
              amount: moneyOut(result.reconciliation.overpaid),
              formatted: formatMoneyTr(result.reconciliation.overpaid, currency),
              message:
                "Fatura tutarından fazla tahsilat yapıldı. Fark, müvekkil cari hesabında " +
                "alacak olarak kalır; AVANS kaydı olarak değerlendirilmesi önerilir.",
            }
          : null,
    };
  }

  /**
   * DELETE /billing/payments/:id
   *
   * Ödeme silinince otomatik TAHSİLAT kaydı da silinir ve fatura durumu
   * yeniden hesaplanır (tam ödenmiş fatura KISMI_ODENDI/GONDERILDI'ye döner).
   * Yalnızca ADMIN/PARTNER siler: parasal kaydın geri alınması denetlenebilir
   * olmalıdır ve AuditLog'a yazılır.
   */
  async remove(user: AuthUser, id: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.INVOICE_ISSUE, "tahsilat kaydı silme");
    const existing = await this.prisma.client.payment.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, invoiceId: true, amount: true, clientId: true },
    });
    if (!existing) throw new NotFoundException("Tahsilat kaydı bulunamadı.");

    const reconciliation = await this.prisma.client.$transaction(async (tx) => {
      await tx.financialEntry.deleteMany({
        where: {
          tenantId: user.tenantId,
          type: "TAHSILAT",
          description: { startsWith: `${AUTO_COLLECTION_MARKER}:${id} ` },
        },
      });
      await tx.payment.delete({ where: { id } });
      return existing.invoiceId
        ? this.invoices.recalcPaymentStatus(tx, user.tenantId, existing.invoiceId)
        : null;
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PAYMENT_DELETE",
      entity: "Payment",
      entityId: id,
      detail:
        `${moneyOut(existing.amount)} tutarındaki tahsilat silindi` +
        `${reconciliation ? ` · fatura durumu: ${reconciliation.status}` : ""}`,
    });
    return { ok: true, id, invoiceStatus: reconciliation?.status ?? null };
  }

  // ------------------------------------------------------------- yardımcılar

  serialize(p: PaymentWithRelations) {
    return {
      id: p.id,
      clientId: p.clientId,
      client: p.client,
      invoiceId: p.invoiceId,
      invoice: p.invoice
        ? {
            id: p.invoice.id,
            invoiceNo: p.invoice.invoiceNo,
            total: moneyOut(p.invoice.total),
            currency: p.invoice.currency,
            status: p.invoice.status,
          }
        : null,
      amount: moneyOut(p.amount),
      // Ö-14: biçimlendirme kaydın KENDİ para birimini kullanır. Eskiden
      // `p.invoice?.currency ?? "TRY"` yazılıydı ve faturasız her tahsilat
      // "5.000,00 TL" diye görünüyordu — tutar EUR olsa bile.
      currency: p.currency,
      amountFormatted: formatMoneyTr(p.amount, p.currency),
      date: p.date,
      method: p.method,
      reference: p.reference,
      note: p.note,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
    };
  }

  private async requireClient(tenantId: string, clientId: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId },
      select: { id: true, name: true },
    });
    if (!client) throw new BadRequestException("Müvekkil bulunamadı.");
    return client;
  }
}
