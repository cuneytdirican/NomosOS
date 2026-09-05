import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PlatformPaymentStatus } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { paged, resolvePage } from "../../common/pagination";
import { PlatformAuditService } from "../platform-audit.service";
import { PlatformApprovalsService } from "../approvals/platform-approvals.service";
import { APPROVAL_ACTIONS } from "../approvals/approval-actions";
import { money } from "../platform-serialize";
import { isAnalyst } from "../platform-permissions";
import { buildDateRange } from "../tenants/platform-tenants.service";
import type { PlatformAuthUser } from "../platform.types";
import type { RefundRequestInput } from "./platform-payments.schemas";

/** Başarısız ödemenin "dunning kuyruğuna" düşme eşiği (gün). */
const DUNNING_AGE_DAYS = 3;

/**
 * PLATFORM TAHSİLATLARI (NomosOS → büro).
 *
 * DİKKAT: bu tablolar büronun MÜVEKKİLİNDEN aldığı para ile karıştırılmamalıdır.
 * Tenant tarafı `Invoice`/`Payment`, platform tarafı `InvoiceRecord`/`PaymentRecord`
 * kullanır; adlandırma bilinçli olarak ayrıştırılmıştır (spec §Veri Modeli).
 *
 * GERÇEK ÖDEME SAĞLAYICISI ENTEGRASYONU YOKTUR. iyzico/Stripe kimlik bilgisi
 * bulunmadığından ne tahsilat ne iade sağlayıcıya iletilir; kayıtlar yalnızca
 * muhasebe izidir. Sahte "başarılı gönderildi" durumu ÜRETİLMEZ.
 */
@Injectable()
export class PlatformPaymentsService {
  private readonly logger = new Logger(PlatformPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly approvals: PlatformApprovalsService
  ) {}

  async list(
    user: PlatformAuthUser,
    query: {
      status?: string;
      tenantId?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    }
  ) {
    this.denyAnalyst(user);

    const where: Prisma.PaymentRecordWhereInput = {};
    if (query.status) {
      const status = query.status.toUpperCase();
      if (!["BEKLIYOR", "BASARILI", "BASARISIZ", "IADE"].includes(status)) {
        throw new BadRequestException(
          "Geçersiz ödeme durumu. Kabul edilenler: BEKLIYOR, BASARILI, BASARISIZ, IADE."
        );
      }
      where.status = status as PlatformPaymentStatus;
    }
    if (query.tenantId) where.tenantId = query.tenantId;
    const range = buildDateRange(query);
    if (range) where.createdAt = range;

    const page = resolvePage(query);
    const [rows, total] = await Promise.all([
      this.prisma.client.paymentRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.paymentRecord.count({ where }),
    ]);

    // HASSAS OKUMA — spec §Güvenlik 8: ödeme detayı açmak da loglanır.
    await this.audit.log({
      actor: user,
      action: "PAYMENT_LIST_VIEW",
      entity: "PaymentRecord",
      tenantId: query.tenantId ?? null,
      detail: `${rows.length}/${total} ödeme kaydı görüntülendi.`,
    });

    return paged(await this.decorate(rows, user), total, page);
  }

  /** Başarısız ödeme / dunning kuyruğu. */
  async failed(user: PlatformAuthUser, query: { page?: string; limit?: string }) {
    this.denyAnalyst(user);

    const page = resolvePage(query);
    const where: Prisma.PaymentRecordWhereInput = { status: "BASARISIZ" };
    const [rows, total] = await Promise.all([
      this.prisma.client.paymentRecord.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.paymentRecord.count({ where }),
    ]);

    const threshold = Date.now() - DUNNING_AGE_DAYS * 24 * 60 * 60 * 1000;
    const decorated = (await this.decorate(rows, user)).map((row, i) => ({
      ...row,
      ageDays: Math.floor((Date.now() - rows[i]!.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      dunningDue: rows[i]!.createdAt.getTime() <= threshold,
    }));

    return {
      ...paged(decorated, total, page),
      note:
        `${DUNNING_AGE_DAYS} günden eski başarısız ödemeler "dunning" kuyruğundadır. ` +
        "Askıya alma dunning zincirinin SON adımıdır ve dört-göz onayı gerektirir; " +
        "bu uçtan doğrudan askı uygulanmaz.",
    };
  }

  /** İADE — DÖRT-GÖZ. Açan kişi kendi talebini onaylayamaz. */
  async requestRefund(user: PlatformAuthUser, id: string, input: RefundRequestInput) {
    const payment = await this.prisma.client.paymentRecord.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException("Ödeme kaydı bulunamadı.");
    if (payment.status !== "BASARILI") {
      throw new BadRequestException(
        `Yalnızca başarılı tahsilatlar iade edilebilir. Bu kaydın durumu: ${payment.status}.`
      );
    }

    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.PAYMENT_REFUND,
      tenantId: payment.tenantId,
      payload: { paymentId: id, reason: input.reason },
      summary:
        `Tutar ${payment.amount.toFixed(2)} ${payment.currency}. Gerekçe: ${input.reason}. ` +
        "Onaylandığında kayıt IADE'ye çekilir; ödeme sağlayıcısına iletim YAPILMAZ " +
        "(entegratör yapılandırılmamış).",
    });
  }

  // -------------------------------------------------------------- faturalar

  async invoices(
    user: PlatformAuthUser,
    query: { tenantId?: string; status?: string; page?: string; limit?: string }
  ) {
    this.denyAnalyst(user);

    const where: Prisma.InvoiceRecordWhereInput = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.status) where.status = query.status.toUpperCase() as never;

    const page = resolvePage(query);
    const [rows, total] = await Promise.all([
      this.prisma.client.invoiceRecord.findMany({
        where,
        orderBy: { issueDate: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.invoiceRecord.count({ where }),
    ]);

    const tenantNames = await this.tenantNames(rows.map((r) => r.tenantId));
    return paged(
      rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: tenantNames.get(r.tenantId) ?? "(silinmiş büro)",
        number: r.number,
        amount: money(r.amount),
        vatAmount: money(r.vatAmount),
        total: money(r.total),
        issueDate: r.issueDate,
        status: r.status,
        hasPdf: Boolean(r.pdfKey),
        createdAt: r.createdAt,
        // Faz 3
        type: r.type,
        description: r.description,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        discountAmount: money(r.discountAmount),
        couponCode: r.couponCode,
        dueDate: r.dueDate,
        paidAt: r.paidAt,
      })),
      total,
      page
    );
  }

  /**
   * TASLAK → GÖNDERİLDİ. Numara burada üretilir.
   *
   * `InvoiceRecord.number` GLOBAL unique'tir (tenant içi değil). İki eşzamanlı
   * istek aynı numarayı hesaplayabileceği için yazma, P2002 (unique ihlali)
   * yakalanarak sınırlı sayıda YENİDEN DENENİR. Sessizce çakışmaya izin
   * verilmez; numara boşluğu bırakmak, iki faturaya aynı numarayı vermekten
   * yeğdir.
   */
  async issueInvoice(user: PlatformAuthUser, id: string) {
    const invoice = await this.prisma.client.invoiceRecord.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException("Platform faturası bulunamadı.");
    if (invoice.status !== "TASLAK") {
      throw new BadRequestException(
        `Yalnızca TASLAK faturalar kesilebilir. Bu faturanın durumu: ${invoice.status}.`
      );
    }

    const year = invoice.issueDate.getUTCFullYear();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const number = await this.nextInvoiceNumber(year);
      try {
        const updated = await this.prisma.client.invoiceRecord.update({
          where: { id },
          data: { number, status: "GONDERILDI" },
        });
        await this.audit.log({
          actor: user,
          action: "INVOICE_ISSUE",
          entity: "InvoiceRecord",
          entityId: id,
          tenantId: invoice.tenantId,
          detail: `Fatura ${number} kesildi. Toplam ${money(invoice.total)} TRY.`,
        });
        return {
          id: updated.id,
          number: updated.number,
          status: updated.status,
          message:
            `Fatura ${number} numarasıyla kesildi. e-Fatura entegratörü yapılandırılmadığı ` +
            "için GİB'e iletim yapılmamıştır.",
        };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          this.logger.warn(`Fatura numarası çakıştı (${number}), yeniden deneniyor.`);
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException(
      "Fatura numarası üretilemedi (art arda çakışma). Lütfen tekrar deneyin."
    );
  }

  private async nextInvoiceNumber(year: number): Promise<string> {
    const prefix = `NOM-${year}-`;
    const last = await this.prisma.client.invoiceRecord.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const lastSeq = last?.number ? Number.parseInt(last.number.slice(prefix.length), 10) : 0;
    const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
    return `${prefix}${String(next).padStart(6, "0")}`;
  }

  // --------------------------------------------------------------- yardımcı

  /**
   * ANALİST KİLİDİ: `payment.view` bu rol için "masked"tır — tekil ödeme
   * kaydı DEĞİL, yalnızca MRR/churn özeti görebilir. Bu yüzden itemize uçlar
   * 403 döner ve kullanıcı Kurul Raporu'na yönlendirilir.
   */
  private denyAnalyst(user: PlatformAuthUser): void {
    if (isAnalyst(user.role)) {
      throw new ForbiddenException(
        "Analist (salt-okur) rolü tekil ödeme/fatura kaydı göremez. Bu rol yalnızca " +
          "toplulaştırılmış gelir özetlerine erişir: GET /metrics/investor."
      );
    }
  }

  /**
   * SUPPORT_AGENT için tutar/sağlayıcı referansı GİZLENİR.
   * Matris: "Ödeme/fatura detayı görüntüle → SUPPORT_AGENT 👁 (yalnız
   * ödendi/ödenmedi)". Destek personelinin sorunu çözmek için tutara değil,
   * ödemenin geçip geçmediğine ihtiyacı vardır.
   */
  private async decorate(
    rows: {
      id: string;
      tenantId: string;
      subscriptionId: string | null;
      amount: Prisma.Decimal;
      currency: string;
      status: PlatformPaymentStatus;
      method: string | null;
      providerRef: string | null;
      paidAt: Date | null;
      failureReason: string | null;
      createdAt: Date;
    }[],
    user: PlatformAuthUser
  ) {
    const tenantNames = await this.tenantNames(rows.map((r) => r.tenantId));
    const limited = user.role === "SUPPORT_AGENT";
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      tenantName: tenantNames.get(r.tenantId) ?? "(silinmiş büro)",
      subscriptionId: r.subscriptionId,
      status: r.status,
      paidAt: r.paidAt,
      createdAt: r.createdAt,
      ...(limited
        ? {
            amount: null,
            currency: null,
            method: null,
            providerRef: null,
            failureReason: r.failureReason ? "Ödeme alınamadı" : null,
            masked: true,
          }
        : {
            amount: money(r.amount),
            currency: r.currency,
            method: r.method,
            providerRef: r.providerRef,
            failureReason: r.failureReason,
            masked: false,
          }),
    }));
  }

  private async tenantNames(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, string>();
    const tenants = await this.prisma.client.tenant.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(tenants.map((t) => [t.id, t.name]));
  }
}
