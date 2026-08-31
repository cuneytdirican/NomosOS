"use client";

/**
 * Ödemelerim — faturalar ve ödeme geçmişi.
 *
 * PARA İLKESİ: bu ekran hiçbir tutarı HESAPLAMAZ. Toplam, kalan ve bakiye
 * yalnızca sunucudan geldiği gibi yazılır (Prisma.Decimal → string). İstemcide
 * toplama/çıkarma yapılsaydı, kuruş farkları müvekkile "yanlış borç" olarak
 * görünürdü. Sunucu bakiye göndermiyorsa toplam UYDURULMAZ; bunun yerine
 * bekleyen fatura sayısı gösterilir.
 *
 * Ayrıca yalnızca yayınlanmış fatura/tahsilat kalemleri gelir; büro içi masraf
 * detayı portala çıkmaz (Modül 10, iş kuralı 10).
 */

import { EP } from "@/lib/endpoints";
import { useListResource, useResource } from "@/lib/useResource";
import {
  INVOICE_STATUS_PLAIN,
  INVOICE_STATUS_TONES,
  PAYMENT_METHOD_PLAIN,
  daysUntil,
  firstOf,
  fmtDate,
  fmtMoney,
  plain,
} from "@/lib/labels";
import type { PortalInvoice, PortalPayment } from "@/lib/types";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  PrivacyNote,
  ResourceView,
  StatCard,
} from "@/components/ui";

const OPEN_INVOICE_STATUSES = new Set(["GONDERILDI", "KISMI_ODENDI"]);

/**
 * ÜÇ AYRI UÇ, TEK EKRAN.
 *
 * Sunucuda birleşik bir "ödemeler" ucu YOKTUR: faturalar `/invoices`,
 * tahsilatlar `/payments`, bakiye ise panel özetinin `finance` bölümündedir
 * (denetim bulgusu G — ekran tek bir `/payments` çağrısından üçünü birden
 * bekliyor, faturalar hiç görünmüyordu).
 *
 * BAKİYE YİNE İSTEMCİDE HESAPLANMAZ: `finance.openBalance` sunucunun
 * `Prisma.Decimal` ile yaptığı hesaptır ve olduğu gibi yazılır.
 */
export default function PaymentsPage() {
  const invoicesRes = useListResource<PortalInvoice>(EP.invoices);
  const paymentsRes = useListResource<PortalPayment>(EP.payments);
  const summary = useResource<{ finance?: PortalFinanceSummary }>(EP.dashboard);

  const finance = summary.data?.finance;
  const model: PaymentsModel = {
    openBalance: finance?.openBalance ?? null,
    balance: null,
    currency: finance?.currency,
    invoices: invoicesRes.data,
    payments: paymentsRes.data,
  };

  // Üç istekten HERHANGİ BİRİ yükleniyorsa ekran yükleniyordur; hata/eksik
  // durumu ise asıl içeriği taşıyan iki listeye göre belirlenir.
  const res = {
    loading: invoicesRes.loading || paymentsRes.loading || summary.loading,
    missing: invoicesRes.missing && paymentsRes.missing,
    forbidden: invoicesRes.forbidden || paymentsRes.forbidden,
    error: invoicesRes.error ?? paymentsRes.error,
    loaded: invoicesRes.loaded && paymentsRes.loaded,
    endpoint: EP.payments,
    reload: () => {
      invoicesRes.reload();
      paymentsRes.reload();
      summary.reload();
    },
  };

  const balanceLabel = fmtMoney(
    model.openBalance ?? model.balance ?? null,
    model.currency ?? "TRY",
  );
  const openInvoices = model.invoices.filter((i) =>
    OPEN_INVOICE_STATUSES.has(i.status ?? ""),
  );

  return (
    <div>
      <PageHeader
        title="Ödemelerim"
        description="Avukatlık ücreti ve masraflarınıza ilişkin faturalar ile yaptığınız ödemeler."
      />

      <ResourceView
        loading={res.loading}
        missing={res.missing}
        forbidden={res.forbidden}
        error={res.error}
        empty={res.loaded && model.invoices.length === 0 && model.payments.length === 0}
        endpoint={res.endpoint}
        onRetry={res.reload}
        loadingLabel="Ödeme bilgileriniz getiriliyor…"
        emptyMessage="Paylaşılmış bir fatura veya ödeme kaydı bulunmuyor."
        emptyHint="Bir fatura düzenlendiğinde burada görünür."
      >
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Bekleyen ödemem"
              emphasis={Boolean(balanceLabel) || openInvoices.length > 0}
              value={
                balanceLabel ??
                (openInvoices.length === 0
                  ? "Bekleyen ödeme yok"
                  : `${openInvoices.length} fatura`)
              }
              hint={
                balanceLabel
                  ? "Ödenmemiş toplam tutarınız."
                  : openInvoices.length > 0
                    ? "Tutarlar aşağıdaki listede fatura fatura gösterilir."
                    : "Ödemeleriniz güncel görünüyor."
              }
            />
            <StatCard
              label="Ödeme geçmişim"
              value={
                model.payments.length === 0
                  ? "Kayıt yok"
                  : `${model.payments.length} ödeme`
              }
              hint="Aşağıda tarih ve tutarlarıyla listelenir."
            />
          </div>

          <Card
            title="Faturalarım"
            subtitle="Ödeme yapmadan önce fatura numarasını avukatınıza teyit ettirin."
          >
            {model.invoices.length > 0 ? (
              <ul className="divide-y divide-rule/60">
                {model.invoices.map((inv) => (
                  <li key={inv.id}>
                    <InvoiceRow invoice={inv} currency={model.currency} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="Sizinle paylaşılmış bir fatura bulunmuyor." />
            )}
          </Card>

          <Card title="Ödemelerim" subtitle="Kaydedilmiş tahsilatlar.">
            {model.payments.length > 0 ? (
              <ul className="divide-y divide-rule/60">
                {model.payments.map((p) => (
                  <li key={p.id}>
                    <PaymentRow payment={p} currency={model.currency} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="Henüz kaydedilmiş bir ödemeniz görünmüyor." />
            )}
          </Card>
        </div>
      </ResourceView>

      <p className="mt-6 text-sm leading-relaxed text-ink-faint">
        Tutarlarda bir uyuşmazlık görürseniz ödeme yapmadan önce avukatınıza yazın.
        Bu sayfa yalnızca bilgilendirme amaçlıdır; ödeme talimatlarını her zaman
        büronuzdan teyit edin.
      </p>

      <div className="mt-8">
        <PrivacyNote />
      </div>
    </div>
  );
}

function InvoiceRow({
  invoice,
  currency,
}: {
  invoice: PortalInvoice;
  currency?: string;
}) {
  const cur = invoice.currency ?? currency ?? "TRY";
  const number = firstOf(invoice.invoiceNumber, invoice.number);
  const issued = fmtDate(invoice.issuedAt ?? invoice.issueDate);
  const due = fmtDate(invoice.dueDate);
  const total = fmtMoney(invoice.total ?? invoice.grandTotal ?? null, cur);
  const remaining = fmtMoney(invoice.remainingAmount ?? null, cur);
  const status = invoice.status;
  const isOpen = OPEN_INVOICE_STATUSES.has(status ?? "");
  const dueDays = invoice.dueDate ? daysUntil(invoice.dueDate) : null;
  const overdue = isOpen && dueDays !== null && dueDays < 0;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-ink">
          {number ? `Fatura ${number}` : "Fatura"}
        </p>
        <p className="mt-1 text-sm text-ink-faint">
          {issued && <span>Düzenlenme: {issued}</span>}
          {due && <span>{issued ? " · " : ""}Vade: {due}</span>}
        </p>
        {invoice.description && (
          <p className="mt-1 max-w-reading text-sm text-ink-soft">{invoice.description}</p>
        )}
        {invoice.caseTitle && (
          <p className="mt-1 text-sm text-ink-soft">{invoice.caseTitle}</p>
        )}
      </div>

      <div className="shrink-0 text-right">
        {total && <p className="tnum text-[15px] font-semibold text-ink">{total}</p>}
        {remaining && isOpen && (
          <p className="tnum mt-0.5 text-sm text-ink-soft">Kalan: {remaining}</p>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {status && (
            <Badge tone={INVOICE_STATUS_TONES[status] ?? "neutral"}>
              {plain(INVOICE_STATUS_PLAIN, status, "Durum bekleniyor")}
            </Badge>
          )}
          {overdue && <Badge tone="warn">Vadesi geçti</Badge>}
        </div>
      </div>
    </div>
  );
}

function PaymentRow({
  payment,
  currency,
}: {
  payment: PortalPayment;
  currency?: string;
}) {
  const cur = payment.currency ?? currency ?? "TRY";
  const when = fmtDate(payment.paidAt ?? payment.date);
  const amount = fmtMoney(payment.amount ?? null, cur);

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[15px] text-ink">{when ?? "Tarih belirtilmemiş"}</p>
        <p className="mt-1 text-sm text-ink-faint">
          {payment.method && plain(PAYMENT_METHOD_PLAIN, payment.method, "Ödeme")}
          {payment.invoiceNumber ? ` · Fatura ${payment.invoiceNumber}` : ""}
        </p>
        {payment.note && (
          <p className="mt-1 max-w-reading text-sm text-ink-soft">{payment.note}</p>
        )}
      </div>
      {amount && (
        <p className="tnum shrink-0 text-[15px] font-semibold text-calm-green">{amount}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yanıt normalizasyonu
// ---------------------------------------------------------------------------

interface PaymentsModel {
  openBalance?: string | number | null;
  balance?: string | number | null;
  currency?: string;
  invoices: PortalInvoice[];
  payments: PortalPayment[];
}

/**
 * Panel özetinin finans bölümü — SUNUCUNUN hesabı.
 *
 * `scope` alanı, bakiyenin büronun defterindeki gerçek bakiye DEĞİL, yalnızca
 * portala yayınlanmış kalemlerin farkı olduğunu söyler; ekran bunu müvekkile
 * aynen aktarmalıdır ki "toplam borcunuz" yanılgısı doğmasın.
 */
export interface PortalFinanceSummary {
  openBalance?: string | null;
  invoiceTotal?: string | null;
  paymentTotal?: string | null;
  currency?: string;
  scope?: string;
}
