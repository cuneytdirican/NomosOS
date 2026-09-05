/**
 * PLATFORM TAHSİLATI — CHECKOUT + KESİNLEŞTİRME (Faz 3).
 *
 * Akış: fatura (GONDERILDI) → PaymentRecord BEKLIYOR (+ checkoutToken) → sağlayıcı
 *   SIMULASYON: anında BASARILI → `settle()`.
 *   IYZICO: ödeme sayfası URL'si → tarayıcı → iyzico → callback (POST token) →
 *           `retrieveCheckout` → tutar/para birimi eşleşiyorsa `settle()`.
 *   Webhook (IYZICO): imza doğrulanır → aynı yol (callback gelmezse ikinci kanal).
 *
 * `settle()` İDEMPOTENT: ödeme zaten BASARILI ise hiçbir şey yapmaz. Kesinleşme
 * tek transaction'dadır: ödeme + fatura ODENDI + (kredi yükleme | abonelik dönemi
 * ilerletme) + kupon sayacı. Yarım durum kalmaz.
 *
 * GELİR KAÇAĞI KAPANDI: krediler artık ÖDEME KESİNLEŞİNCE yüklenir (Faz 0 öncesi
 * "anında yükle, fatura taslak" davranışı kaldırıldı). Sağlayıcı yoksa 503 —
 * büro havale/EFT ile öder, platform ekibi `mark-paid` ile kesinleştirir.
 */

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Prisma, type InvoiceRecord, type PaymentRecord } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PlatformAuditService } from "../platform/platform-audit.service";
import { CreditService } from "../credits/credit.service";
import { OdemeSaglayici } from "../billing/odeme-saglayici";
import { computePackageCharge } from "../billing/subscription-pricing";
import { apiPublicUrl, webOrigin } from "../common/public-urls";
import { ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";
import type { PlatformAuthUser } from "../platform/platform.types";
import { CouponService } from "./coupon.service";
import { isUniqueViolation, nextPlatformInvoiceNumber } from "./platform-invoice-number";
import { invoiceRecordDto } from "./subscription-invoice.service";

export interface CheckoutStartResult {
  odendi: boolean;
  odemeSayfasi: string | null;
  fatura: ReturnType<typeof invoiceRecordDto>;
  odemeId: string;
  mesaj: string;
}

const UNPAID: Array<InvoiceRecord["status"]> = ["GONDERILDI", "TASLAK", "KISMI_ODENDI"];

@Injectable()
export class PlatformCheckoutService {
  private readonly logger = new Logger(PlatformCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly saglayici: OdemeSaglayici,
    private readonly credits: CreditService,
    private readonly coupons: CouponService,
    private readonly audit: AuditService,
    private readonly platformAudit: PlatformAuditService,
  ) {}

  // ------------------------------------------------------------ kredi paketi

  async startCreditPurchase(user: AuthUser, packageKey: string, couponCode: string | null | undefined, ip: string): Promise<CheckoutStartResult> {
    assertRole(user, ROLE_SETS.ONAY, "kredi paketi satın alma");
    const pkg = await this.prisma.client.creditPackage.findUnique({ where: { key: packageKey } });
    if (!pkg || !pkg.isActive) throw new BadRequestException(`"${packageKey}" anahtarlı satılabilir bir paket bulunamadı.`);
    const wallet = await this.prisma.client.creditWallet.findUnique({ where: { tenantId: user.tenantId } });
    if (!wallet) {
      throw new BadRequestException("Büronuz için kredi cüzdanı tanımlı değil; bu modda kota uygulanmadığı için paket satın almanız gerekmiyor.");
    }
    const coupon = couponCode ? await this.coupons.requireValid(couponCode, "KREDI") : null;
    const charge = computePackageCharge(pkg.price, coupon);
    const now = new Date();

    const invoice = await this.createInvoice({
      tenantId: user.tenantId,
      type: "KREDI_PAKETI",
      description: `Ek kredi paketi ${pkg.key} · ${pkg.credits} kredi` + (charge.discountReason ? ` · ${charge.discountReason}` : ""),
      charge,
      now,
      metaJson: JSON.stringify({ packageKey: pkg.key, credits: pkg.credits, listAmount: charge.listAmount.toFixed(2) }),
    });
    return this.startPayment(user, invoice, ip, `Kredi paketi ${pkg.key} (${pkg.credits} kredi)`);
  }

  // ------------------------------------------------------------ fatura ödeme

  async startInvoicePayment(user: AuthUser, invoiceId: string, ip: string): Promise<CheckoutStartResult> {
    assertRole(user, ROLE_SETS.ONAY, "platform faturası ödeme");
    const invoice = await this.prisma.client.invoiceRecord.findFirst({ where: { id: invoiceId, tenantId: user.tenantId } });
    if (!invoice) throw new NotFoundException("Fatura bulunamadı.");
    if (!UNPAID.includes(invoice.status)) throw new ConflictException(`Bu fatura ödenebilir durumda değil (${invoice.status}).`);
    return this.startPayment(user, invoice, ip, invoice.description ?? `Fatura ${invoice.number ?? invoice.id}`);
  }

  private async startPayment(user: AuthUser, invoice: InvoiceRecord, ip: string, description: string): Promise<CheckoutStartResult> {
    const [tenant, buyer] = await Promise.all([
      this.prisma.client.tenant.findUnique({ where: { id: invoice.tenantId }, select: { name: true, address: true, taxNumber: true } }),
      this.prisma.client.user.findUnique({ where: { id: user.userId }, select: { fullName: true, email: true } }),
    ]);
    const checkoutToken = randomBytes(18).toString("hex");
    const payment = await this.prisma.client.paymentRecord.create({
      data: {
        tenantId: invoice.tenantId,
        subscriptionId: invoice.type === "ABONELIK" || invoice.type === "PLAN_FARKI" ? (await this.prisma.client.subscription.findUnique({ where: { tenantId: invoice.tenantId }, select: { id: true } }))?.id ?? null : null,
        invoiceRecordId: invoice.id,
        amount: invoice.total,
        currency: "TRY",
        status: "BEKLIYOR",
        method: this.saglayici.turu,
        checkoutToken,
      },
    });

    const checkout = await this.saglayici.createCheckout({
      checkoutToken,
      amount: invoice.total.toFixed(2),
      currency: "TRY",
      description,
      buyer: { id: user.userId, name: buyer?.fullName ?? tenant?.name ?? "Büro", email: buyer?.email ?? "", ip, address: tenant?.address, taxNumber: tenant?.taxNumber },
      callbackUrl: `${apiPublicUrl()}/api/v1/billing/odeme/callback`,
    });

    if (checkout.immediate) {
      const settled = await this.settle(payment.id, { ref: checkout.ref, method: "SIMULASYON", raw: { simulasyon: true } });
      return {
        odendi: true,
        odemeSayfasi: null,
        fatura: invoiceRecordDto(settled.invoice),
        odemeId: payment.id,
        mesaj: settled.mesaj,
      };
    }
    await this.prisma.client.paymentRecord.update({
      where: { id: payment.id },
      data: { providerRef: checkout.ref, providerPayload: JSON.stringify({ providerToken: checkout.providerToken }) },
    });
    return {
      odendi: false,
      odemeSayfasi: checkout.paymentPageUrl,
      fatura: invoiceRecordDto(invoice),
      odemeId: payment.id,
      mesaj: "Ödeme sayfasına yönlendiriliyorsunuz. Ödeme tamamlanınca fatura ödendi olarak işaretlenir.",
    };
  }

  // ------------------------------------------------------------ kesinleştirme

  /**
   * Ödemeyi kesinleştirir (idempotent). Kredi paketi → cüzdana yükle; abonelik →
   * dönemi ilerlet + ACTIVE. Tutar uyuşmazlığında REDDEDER (para kaynağı bizdeki fatura).
   */
  async settle(paymentId: string, input: { ref: string; method: string; raw?: Record<string, unknown>; paidPrice?: string | null; currency?: string | null; actor?: PlatformAuthUser | null }) {
    return this.prisma.client.$transaction(async (tx) => {
      const payment = await tx.paymentRecord.findUnique({ where: { id: paymentId }, include: { invoiceRecord: true } });
      if (!payment || !payment.invoiceRecord) throw new NotFoundException("Ödeme kaydı bulunamadı.");
      const invoice = payment.invoiceRecord;
      if (payment.status === "BASARILI") {
        return { invoice, payment, mesaj: "Ödeme zaten kesinleşmiş.", yeni: false };
      }
      if (input.paidPrice !== undefined && input.paidPrice !== null) {
        const paid = new Prisma.Decimal(input.paidPrice).toDecimalPlaces(2);
        if (!paid.equals(payment.amount) || (input.currency && input.currency.toUpperCase() !== payment.currency.toUpperCase())) {
          await tx.paymentRecord.update({ where: { id: payment.id }, data: { status: "BASARISIZ", providerRef: input.ref, providerPayload: JSON.stringify({ reddedildi: "tutar/para birimi uyuşmazlığı", paid: input.paidPrice, currency: input.currency, ...(input.raw ?? {}) }).slice(0, 4000) } });
          throw new ConflictException(`Sağlayıcı tutarı (${input.paidPrice} ${input.currency ?? ""}) fatura tutarıyla (${payment.amount.toFixed(2)} ${payment.currency}) uyuşmuyor; ödeme kesinleştirilmedi.`);
        }
      }
      const now = new Date();
      const updatedPayment = await tx.paymentRecord.update({
        where: { id: payment.id },
        data: { status: "BASARILI", paidAt: now, providerRef: input.ref, method: input.method, providerPayload: input.raw ? JSON.stringify(input.raw).slice(0, 4000) : payment.providerPayload },
      });
      const updatedInvoice = await tx.invoiceRecord.update({ where: { id: invoice.id }, data: { status: "ODENDI", paidAt: now } });

      let detail = `Fatura ${invoice.number ?? invoice.id} ödendi (${input.method}, ref ${input.ref}); ${invoice.total.toFixed(2)} TRY.`;
      if (invoice.type === "KREDI_PAKETI") {
        const meta = JSON.parse(invoice.metaJson ?? "{}") as { packageKey?: string; credits?: number };
        if (meta.packageKey && meta.credits) {
          await this.credits.loadPaidPackage(tx, { tenantId: invoice.tenantId, packageKey: meta.packageKey, credits: meta.credits, invoiceId: invoice.id, total: invoice.total.toFixed(2) });
          detail += ` ${meta.credits} kredi cüzdana yüklendi.`;
        }
      } else if (invoice.type === "ABONELIK" && invoice.periodStart && invoice.periodEnd) {
        const sub = await tx.subscription.findUnique({ where: { tenantId: invoice.tenantId } });
        if (sub && sub.status !== "CANCELED") {
          const advance = !sub.currentPeriodEnd || invoice.periodEnd.getTime() > sub.currentPeriodEnd.getTime();
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              status: "ACTIVE",
              ...(advance ? { currentPeriodStart: invoice.periodStart, currentPeriodEnd: invoice.periodEnd } : {}),
              trialEndsAt: null,
            },
          });
          detail += ` Abonelik ${sub.status} → ACTIVE; dönem ${invoice.periodStart.toISOString().slice(0, 10)} – ${invoice.periodEnd.toISOString().slice(0, 10)}.`;
        }
      }
      if (invoice.couponCode) await this.coupons.redeem(invoice.couponCode, tx);

      await this.audit.log({ tenantId: invoice.tenantId, action: "PLATFORM_FATURA_ODENDI", entity: "InvoiceRecord", entityId: invoice.id, detail });
      await this.platformAudit.log({ actor: input.actor ?? null, action: "PAYMENT_SETTLED", entity: "PaymentRecord", entityId: payment.id, tenantId: invoice.tenantId, detail });
      return { invoice: updatedInvoice, payment: updatedPayment, mesaj: detail, yeni: true };
    });
  }

  /** Sağlayıcı geri dönüşü (iyzico callback / webhook) → yönlendirme adresi. */
  async completeProviderCheckout(providerToken: string): Promise<{ redirectUrl: string; ok: boolean }> {
    const outcome = await this.saglayici.retrieveCheckout(providerToken);
    const payment = await this.findPaymentForOutcome(outcome.conversationId, providerToken);
    const base = `${webOrigin()}/app/ayarlar/abonelik`;
    if (!payment) {
      this.logger.warn(`Sağlayıcı geri dönüşü eşlenemedi (token ${providerToken.slice(0, 8)}…).`);
      return { redirectUrl: `${base}?odeme=eslesmedi`, ok: false };
    }
    if (outcome.status === "BASARILI") {
      try {
        await this.settle(payment.id, { ref: outcome.ref, method: "IYZICO", raw: outcome.raw, paidPrice: outcome.paidPrice, currency: outcome.currency });
        return { redirectUrl: `${base}?odeme=basarili&fatura=${payment.invoiceRecordId ?? ""}`, ok: true };
      } catch (err) {
        return { redirectUrl: `${base}?odeme=basarisiz&neden=${encodeURIComponent((err as Error).message.slice(0, 120))}`, ok: false };
      }
    }
    if (outcome.status === "BASARISIZ" && payment.status === "BEKLIYOR") {
      await this.prisma.client.paymentRecord.update({ where: { id: payment.id }, data: { status: "BASARISIZ", providerRef: outcome.ref, providerPayload: JSON.stringify(outcome.raw).slice(0, 4000) } });
    }
    return { redirectUrl: `${base}?odeme=${outcome.status === "BASARISIZ" ? "basarisiz" : "bekliyor"}`, ok: false };
  }

  async handleWebhook(headers: Record<string, string | string[] | undefined>, body: Record<string, unknown>): Promise<{ ok: boolean; islendi: boolean }> {
    if (!this.saglayici.verifyWebhook(headers, body)) {
      this.logger.warn("Ödeme webhook imzası doğrulanamadı; bildirim yok sayıldı.");
      return { ok: false, islendi: false };
    }
    const token = typeof body.token === "string" ? body.token : null;
    if (!token) return { ok: true, islendi: false };
    const res = await this.completeProviderCheckout(token);
    return { ok: true, islendi: res.ok };
  }

  /** Platform ekibi: havale/EFT ile ödenen faturayı elle kesinleştirir. */
  async markPaidManual(actor: PlatformAuthUser, invoiceId: string, input: { method: string; reference: string; note?: string | null }) {
    const invoice = await this.prisma.client.invoiceRecord.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException("Platform faturası bulunamadı.");
    if (invoice.status === "ODENDI") throw new ConflictException("Fatura zaten ödenmiş.");
    if (!UNPAID.includes(invoice.status)) throw new ConflictException(`Fatura ${invoice.status} durumunda; ödendi işaretlenemez.`);
    const payment = await this.prisma.client.paymentRecord.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceRecordId: invoice.id,
        subscriptionId: (await this.prisma.client.subscription.findUnique({ where: { tenantId: invoice.tenantId }, select: { id: true } }))?.id ?? null,
        amount: invoice.total,
        currency: "TRY",
        status: "BEKLIYOR",
        method: input.method,
        checkoutToken: randomBytes(18).toString("hex"),
      },
    });
    const res = await this.settle(payment.id, { ref: input.reference, method: input.method, raw: { manuel: true, not: input.note ?? null, isaretleyen: actor.id }, actor });
    return { fatura: invoiceRecordDto(res.invoice), mesaj: res.mesaj };
  }

  // ------------------------------------------------------------ yardımcılar

  private async findPaymentForOutcome(conversationId: string | null, providerToken: string): Promise<PaymentRecord | null> {
    if (conversationId) {
      const byToken = await this.prisma.client.paymentRecord.findUnique({ where: { checkoutToken: conversationId } });
      if (byToken) return byToken;
    }
    return this.prisma.client.paymentRecord.findFirst({ where: { providerPayload: { contains: providerToken } }, orderBy: { createdAt: "desc" } });
  }

  private async createInvoice(input: {
    tenantId: string;
    type: "KREDI_PAKETI" | "PLAN_FARKI";
    description: string;
    charge: ReturnType<typeof computePackageCharge>;
    now: Date;
    metaJson: string;
  }): Promise<InvoiceRecord> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const number = await nextPlatformInvoiceNumber(tx, input.now.getUTCFullYear());
          return tx.invoiceRecord.create({
            data: {
              tenantId: input.tenantId,
              type: input.type,
              number,
              description: input.description,
              // Kredi paketi dönemsiz: tekil indeks (tenant,type,periodStart) NULL'ları ayrı sayar.
              periodStart: null,
              amount: input.charge.amount,
              discountAmount: input.charge.discountAmount,
              couponCode: input.charge.couponCode,
              vatAmount: input.charge.vatAmount,
              total: input.charge.total,
              issueDate: input.now,
              dueDate: new Date(input.now.getTime() + 7 * 86_400_000),
              status: "GONDERILDI",
              metaJson: input.metaJson,
            },
          });
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new BadRequestException("Fatura numarası üretilemedi; tekrar deneyin.");
  }
}
