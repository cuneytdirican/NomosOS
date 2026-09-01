/**
 * PORTAL ÖDEME BAĞLAMASI (rakip analizi — E8).
 *
 * AKIŞ:
 *   1. Büro (PAYMENT_WRITE yetkisi) fatura için TEK KULLANIMLIK bağlantı üretir:
 *      POST /billing/invoices/:id/odeme-linki → token'lı URL.
 *   2. Bağlantı müvekkile gönderilir (e-posta/portal).
 *   3. Müvekkil bağlantıyı açar (kimlik GEREKMEZ — token'ın kendisi yetkidir):
 *      GET /portal/odeme/:token → fatura bilgisi.
 *   4. Ödeme: POST /portal/odeme/:token/ode → sağlayıcı (SIMULASYON veya 503)
 *      → Payment(ONLINE) + FinancialEntry(TAHSILAT) + fatura durumu yeniden
 *      hesap — PaymentsService ile AYNI para disiplini.
 *
 * TEK KULLANIMLIK GARANTİSİ: ödeme transaction'ında bağlantı satırı FOR UPDATE
 * ile kilitlenir; iki eşzamanlı ödeme yarışında ikincisi GÜNCEL durumu okur ve
 * 409 alır (PaymentsService'teki fazla-ödeme kilidiyle aynı desen).
 *
 * TUTAR: bağlantı OLUŞTURULDUĞU ANDAKİ kalan bakiyedir; ödeme anında kalan
 * değişmişse (başka tahsilat gelmişse) ödeme yalnızca KALAN kadar yapılır —
 * kalan sıfırsa 409 (fazla ödeme portaldan kabul edilmez; avans kararı
 * büronun işlemidir, müvekkilin değil).
 */

import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InvoicesService } from "./invoices.service";
import { OdemeSaglayici } from "./odeme-saglayici";
import { assertFinanceAccess, FINANCE_ACCESS } from "../finance/finance-access";
import { moneyOut } from "../finance/money";
import type { AuthUser } from "../common/types";

/** Bağlantı geçerlilik süresi (gün). */
export const ODEME_LINKI_GECERLILIK_GUN = 30;

@Injectable()
export class OdemeLinkiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly saglayici: OdemeSaglayici,
  ) {}

  /** Büro: fatura için ödeme bağlantısı üretir. */
  async create(user: AuthUser, invoiceId: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.PAYMENT_WRITE, "ödeme bağlantısı üretme");

    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenantId: user.tenantId },
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        total: true,
        currency: true,
        clientId: true,
        client: { select: { id: true, name: true } },
        payments: { select: { amount: true } },
      },
    });
    if (!invoice) throw new NotFoundException("Fatura bulunamadı.");
    if (invoice.status === "TASLAK") {
      throw new BadRequestException("Taslak fatura için ödeme bağlantısı üretilemez.");
    }
    if (invoice.status === "IPTAL") {
      throw new BadRequestException("İptal edilmiş fatura için ödeme bağlantısı üretilemez.");
    }

    const alreadyPaid = invoice.payments.reduce(
      (acc, p) => acc.add(p.amount),
      new Prisma.Decimal(0),
    );
    const remaining = invoice.total.sub(alreadyPaid);
    if (remaining.lte(0)) {
      throw new ConflictException("Faturanın kalan bakiyesi yok; ödeme bağlantısı anlamsız.");
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ODEME_LINKI_GECERLILIK_GUN * 86_400_000);

    const row = await this.prisma.client.odemeLinki.create({
      data: {
        tenantId: user.tenantId,
        invoiceId: invoice.id,
        token,
        amount: remaining,
        currency: invoice.currency,
        status: "AKTIF",
        expiresAt,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ODEME_LINKI_CREATE",
      entity: "OdemeLinki",
      entityId: row.id,
      detail: `${invoice.client.name} — ${invoice.invoiceNo ?? "-"} · kalan ${moneyOut(remaining)} ${invoice.currency}`,
    });

    return {
      token: row.token,
      amount: moneyOut(row.amount),
      currency: row.currency,
      expiresAt: (row.expiresAt ?? new Date(Date.now() + ODEME_LINKI_GECERLILIK_GUN * 86_400_000)).toISOString(),
      // Gönderilecek URL — portal kökü ortam değişkeniyle çözülür.
      odemeUrl: `/portal/odeme/${row.token}`,
    };
  }

  /** Portal (public): bağlantının fatura bilgisi — kimlik istemez. */
  async view(token: string) {
    const link = await this.requireLink(token);
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: link.invoiceId },
      select: {
        invoiceNo: true,
        status: true,
        client: { select: { name: true } },
        payments: { select: { amount: true } },
      },
    });
    if (!invoice) throw new NotFoundException("Bağlantının faturası bulunamadı.");
    const alreadyPaid = invoice.payments.reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0));
    return {
      faturaNo: invoice.invoiceNo,
      musteriAdi: invoice.client.name,
      faturaDurumu: invoice.status,
      tutar: moneyOut(link.amount),
      paraBirimi: link.currency,
      baglantiDurumu: link.status,
      suresi: link.expiresAt?.toISOString() ?? null,
      // KALAN bakiye bağlantı tutarından azsa (arada tahsilat gelmişse) ödeme
      // kalan kadar yapılır — bu bilgi müvekkile dürüstçe gösterilir.
      kalanBakiye:
        alreadyPaid.gte(0) && invoice.status !== "IPTAL"
          ? moneyOut(link.amount.sub(alreadyPaid.gt(link.amount) ? link.amount : alreadyPaid))
          : moneyOut(link.amount),
    };
  }

  /** Portal (public): ödemeyi çalıştırır — para disiplini PaymentsService ile aynı. */
  async pay(token: string) {
    // 1) Sağlayıcı kontrollü: ödeme DENEMESİ bile yapılandırma yoksa 503 alır.
    const link = await this.requireLink(token);
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: link.invoiceId },
      select: { id: true, invoiceNo: true, status: true, total: true, currency: true, clientId: true, client: { select: { name: true } } },
    });
    if (!invoice) throw new NotFoundException("Bağlantının faturası bulunamadı.");
    if (invoice.status === "IPTAL") {
      throw new ConflictException("Fatura iptal edilmiş; ödeme alınamaz.");
    }

    const sonuc = await this.saglayici.charge({
      amount: moneyOut(link.amount),
      currency: link.currency,
    });

    // 2) Ödeme kaydı — bağlantı satırı kilitlenir; tek kullanımlık yarışta korunur.
    const result = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "OdemeLinki" WHERE "token" = ${token} FOR UPDATE`;
      const fresh = await tx.odemeLinki.findUnique({ where: { token } });
      if (!fresh || fresh.status !== "AKTIF") {
        throw new ConflictException("Bu ödeme bağlantısı artık aktif değil.");
      }
      if (fresh.expiresAt && fresh.expiresAt.getTime() < Date.now()) {
        await tx.odemeLinki.update({ where: { id: fresh.id }, data: { status: "IPTAL" } });
        throw new GoneException("Ödeme bağlantısının geçerlilik süresi dolmuş.");
      }

      const paidAgg = await tx.payment.aggregate({
        where: { tenantId: fresh.tenantId, invoiceId: fresh.invoiceId },
        _sum: { amount: true },
      });
      const alreadyPaid = paidAgg._sum.amount ?? new Prisma.Decimal(0);
      const remaining = invoice.total.sub(alreadyPaid);
      if (remaining.lte(0)) {
        await tx.odemeLinki.update({ where: { id: fresh.id }, data: { status: "IPTAL" } });
        throw new ConflictException("Fatura bu arada tamamen ödenmiş; tahsilat yapılmadı.");
      }
      // Tutar: bağlantı tutarı ile KALAN bakiyenin KÜÇÜĞÜ (fazla ödeme yok).
      const amount = remaining.lt(fresh.amount) ? remaining : fresh.amount;

      const payment = await tx.payment.create({
        data: {
          tenantId: fresh.tenantId,
          invoiceId: fresh.invoiceId,
          clientId: invoice.clientId,
          amount,
          currency: invoice.currency,
          date: new Date(),
          method: "ONLINE",
          reference: sonuc.ref,
          note: `[PORTAL-ODEME] bağlantı=${fresh.id.slice(0, 8)}`,
          createdBy: "system:portal-odeme",
        },
      });

      await tx.financialEntry.create({
        data: {
          tenantId: fresh.tenantId,
          clientId: invoice.clientId,
          type: "TAHSILAT",
          amount,
          currency: invoice.currency,
          date: new Date(),
          description: `[OTO-TAHSILAT]:${payment.id} ${invoice.invoiceNo ?? "-"} numaralı fatura portal ödemesi (${sonuc.ref})`,
          invoiceId: fresh.invoiceId,
          isBillable: false,
        },
      });

      await tx.odemeLinki.update({
        where: { id: fresh.id },
        data: { status: "ODENDI", paidAt: new Date(), paidPaymentId: payment.id },
      });

      const reconciliation = await this.invoices.recalcPaymentStatus(
        tx,
        fresh.tenantId,
        fresh.invoiceId,
      );
      return { payment, reconciliation, amount };
    });

    await this.audit.log({
      tenantId: link.tenantId,
      userId: "system:portal-odeme",
      action: "ODEME_LINKI_ODEME",
      entity: "OdemeLinki",
      entityId: link.id,
      detail:
        `${invoice.client.name} — ${moneyOut(result.amount)} ${invoice.currency} · ref ${sonuc.ref}` +
        `${result.reconciliation ? ` · fatura durumu: ${result.reconciliation.status}` : ""}`,
    });

    return {
      ok: true as const,
      odemeTutari: moneyOut(result.amount),
      paraBirimi: invoice.currency,
      referans: sonuc.ref,
      faturaDurumu: result.reconciliation?.status ?? null,
    };
  }

  private async requireLink(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new NotFoundException("Ödeme bağlantısı bulunamadı.");
    }
    const link = await this.prisma.client.odemeLinki.findUnique({ where: { token } });
    if (!link) throw new NotFoundException("Ödeme bağlantısı bulunamadı.");
    return link;
  }
}
