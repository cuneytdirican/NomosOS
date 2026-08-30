"use client";

/**
 * Ödemeler — PaymentRecord listesi, başarısız ödeme/dunning kuyruğu, iade akışı, platform faturaları.
 * NOT: Buradaki faturalar platformun TENANT'a kestiği InvoiceRecord'lardır;
 * tenant'ın müvekkiline kestiği Invoice/Payment (Modül 09) ile karıştırılmamalıdır.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
import { isMasked } from "@/lib/rbac";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalNotice } from "@/components/ApprovalBadge";
import {
  DUNNING_STEP_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  labelOf,
  toneOf,
} from "@/lib/labels";
import {
  MOCK_INVOICES,
  MOCK_OVERVIEW,
  MOCK_PAYMENTS,
  type AdminInvoice,
  type AdminPayment,
} from "@/lib/mock";
import {
  Badge,
  Button,
  Card,
  DataRow,
  Field,
  InfoBox,
  MockBadge,
  Modal,
  PageHeader,
  PendingEndpointNotice,
  Select,
  StatCard,
  Table,
  Tabs,
  Textarea,
  WarningBox,
  type Column,
} from "@/components/ui";

type TabKey = "odemeler" | "basarisiz" | "faturalar";

export default function OdemelerPage() {
  return (
    <PageGate action="payment.view">
      <Payments />
    </PageGate>
  );
}

function Payments() {
  const { role } = useAdminSession();
  const [tab, setTab] = useState<TabKey>("odemeler");
  const [statusFilter, setStatusFilter] = useState("");
  const [refundFor, setRefundFor] = useState<AdminPayment | null>(null);

  const payments = useResource<AdminPayment[]>("/payments", [...MOCK_PAYMENTS], {
    query: { status: statusFilter || undefined },
  });
  const invoices = useResource<AdminInvoice[]>("/invoices", [...MOCK_INVOICES]);

  /** SUPPORT_AGENT yalnız "ödendi/ödenmedi" görür — tutar ve sağlayıcı referansı gizlenir. */
  const limited = role === "SUPPORT_AGENT";

  const failed = useMemo(
    () => payments.data.filter((p) => p.status === "FAILED"),
    [payments.data],
  );

  const rows = useMemo(
    () =>
      payments.data.filter((p) => (statusFilter ? p.status === statusFilter : true)),
    [payments.data, statusFilter],
  );

  if (isMasked(role, "payment.view")) return <MaskedPaymentsView />;

  const paymentColumns: Array<Column<AdminPayment>> = [
    {
      key: "tenant",
      header: "Tenant",
      render: (p) => (
        <Link href={`/tenantlar/${p.tenantId}`} className="text-steel-50 hover:text-accent-300">
          {p.tenantName}
        </Link>
      ),
    },
    {
      key: "amount",
      header: "Tutar",
      align: "right",
      render: (p) =>
        limited ? (
          <span className="text-steel-500">gizli</span>
        ) : (
          <span className="font-mono">{fmtMoney(p.amount, p.currency)}</span>
        ),
    },
    {
      key: "status",
      header: "Durum",
      render: (p) => (
        <Badge tone={toneOf(PAYMENT_STATUS_TONES, p.status)}>
          {labelOf(PAYMENT_STATUS_LABELS, p.status)}
        </Badge>
      ),
    },
    { key: "method", header: "Yöntem", render: (p) => labelOf(PAYMENT_METHOD_LABELS, p.method) },
    {
      key: "provider",
      header: "Sağlayıcı",
      render: (p) =>
        limited ? (
          <span className="text-steel-500">—</span>
        ) : (
          <span className="text-xs">
            {p.provider}
            <span className="ml-1 font-mono text-steel-500">{p.providerRef}</span>
          </span>
        ),
    },
    { key: "created", header: "Oluşturma", render: (p) => fmtDateTime(p.createdAt) },
    { key: "paid", header: "Ödeme", render: (p) => (p.paidAt ? fmtDateTime(p.paidAt) : "—") },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (p) =>
        p.status === "SUCCEEDED" ? (
          <RoleGate action="payment.refund" mutation>
            <Button size="sm" variant="secondary" onClick={() => setRefundFor(p)}>
              İade talebi
            </Button>
          </RoleGate>
        ) : null,
    },
  ];

  const failedColumns: Array<Column<AdminPayment>> = [
    {
      key: "tenant",
      header: "Tenant",
      render: (p) => (
        <Link href={`/tenantlar/${p.tenantId}`} className="text-steel-50 hover:text-accent-300">
          {p.tenantName}
        </Link>
      ),
    },
    {
      key: "amount",
      header: "Tutar",
      align: "right",
      render: (p) => (limited ? "—" : <span className="font-mono">{fmtMoney(p.amount, p.currency)}</span>),
    },
    {
      key: "reason",
      header: "Hata",
      render: (p) => (
        <div>
          <p className="text-steel-200">{p.failureReason}</p>
          <p className="font-mono text-xs text-steel-500">{p.failureCode}</p>
        </div>
      ),
    },
    { key: "attempt", header: "Deneme", align: "right", render: (p) => fmtNumber(p.attempt ?? 0) },
    {
      key: "step",
      header: "Dunning adımı",
      render: (p) => (
        <Badge tone={p.dunningStep === "ASKIYA_ALMA" ? "danger" : "yellow"}>
          {labelOf(DUNNING_STEP_LABELS, p.dunningStep)}
        </Badge>
      ),
    },
    { key: "created", header: "Son deneme", render: (p) => fmtDateTime(p.createdAt) },
  ];

  const invoiceColumns: Array<Column<AdminInvoice>> = [
    { key: "no", header: "Fatura no", render: (i) => <span className="font-mono text-xs">{i.number}</span> },
    { key: "tenant", header: "Tenant", render: (i) => i.tenantName },
    {
      key: "period",
      header: "Dönem",
      render: (i) => (
        <span className="text-xs text-steel-400">
          {i.periodStart} → {i.periodEnd}
        </span>
      ),
    },
    { key: "subtotal", header: "Ara toplam", align: "right", render: (i) => fmtMoney(i.subtotal) },
    { key: "vat", header: "KDV", align: "right", render: (i) => fmtMoney(i.vat) },
    { key: "total", header: "Toplam", align: "right", render: (i) => <strong>{fmtMoney(i.total)}</strong> },
    {
      key: "status",
      header: "Durum",
      render: (i) => (
        <Badge tone={toneOf(INVOICE_STATUS_TONES, i.status)}>
          {labelOf(INVOICE_STATUS_LABELS, i.status)}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (i) =>
        i.status === "DRAFT" ? (
          <RoleGate action="invoice.issue" mutation>
            <Button size="sm" variant="secondary" disabled title="Uç henüz uygulanmadı">
              Kes (ISSUED)
            </Button>
          </RoleGate>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ödemeler"
        description="Platform tahsilatı: abonelik ödemeleri, dunning kuyruğu, iade akışı ve platform faturaları."
        action={payments.pending ? <MockBadge /> : undefined}
      />

      {limited && (
        <InfoBox title="Salt-okur destek görünümü (👁)">
          Destek rolünde yalnız <strong>ödendi/ödenmedi</strong> bilgisi görünür; tutar, sağlayıcı
          referansı ve fatura detayı gizlenir. Her ödeme detayı görüntülemesi PlatformAuditLog&apos;a
          yazılır.
        </InfoBox>
      )}

      {payments.pending && <PendingEndpointNotice endpoint="/payments" phase="Faz 3" />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Başarısız ödeme"
          value={fmtNumber(failed.length)}
          tone={failed.length > 0 ? "red" : "steel"}
          hint="dunning kuyruğunda"
        />
        <StatCard
          label="Bekleyen tahsilat"
          value={limited ? "—" : fmtMoney(failed.reduce((a, p) => a + p.amount, 0))}
        />
        <StatCard label="Açık fatura" value={fmtNumber(invoices.data.filter((i) => i.status !== "PAID").length)} />
        <StatCard label="MRR" value={limited ? "—" : fmtMoney(MOCK_OVERVIEW.mrr)} tone="accent" />
      </div>

      <Tabs
        tabs={[
          { key: "odemeler", label: "Ödeme kayıtları", count: rows.length },
          { key: "basarisiz", label: "Başarısız / Dunning", count: failed.length },
          { key: "faturalar", label: "Faturalar", count: invoices.data.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "odemeler" && (
        <>
          <Card bodyClassName="p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Durum">
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Tümü</option>
                  {Object.keys(PAYMENT_STATUS_LABELS).map((s) => (
                    <option key={s} value={s}>
                      {PAYMENT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button variant="secondary" onClick={() => setStatusFilter("")}>
                  Temizle
                </Button>
              </div>
            </div>
          </Card>
          <Card title={`${rows.length} ödeme kaydı`}>
            <Table columns={paymentColumns} rows={rows} rowKey={(p) => p.id} dense />
          </Card>
        </>
      )}

      {tab === "basarisiz" && (
        <>
          <WarningBox title="Dunning zinciri">
            e-posta → uyarı → askıya alma. Askıya alma zincirin <strong>son</strong> adımıdır ve
            dört-göz onayı gerektirir; <code className="font-mono">PAST_DUE → SUSPENDED</code> geçişi{" "}
            <code className="font-mono">past_due_grace_days</code> ayarına bağlı cron ile yapılır.
          </WarningBox>
          <Card title={`${failed.length} başarısız ödeme`}>
            <Table columns={failedColumns} rows={failed} rowKey={(p) => p.id} dense />
          </Card>
        </>
      )}

      {tab === "faturalar" && (
        <>
          {invoices.pending && <PendingEndpointNotice endpoint="/invoices" phase="Faz 3" />}
          <Card
            title={`${invoices.data.length} platform faturası`}
            subtitle="InvoiceRecord — platformun tenant'a kestiği faturalar (müvekkil faturaları DEĞİL)."
          >
            <Table columns={invoiceColumns} rows={invoices.data} rowKey={(i) => i.id} dense />
          </Card>
        </>
      )}

      <Modal
        open={refundFor !== null}
        onClose={() => setRefundFor(null)}
        title="İade talebi"
        subtitle={refundFor ? `POST /payments/${refundFor.id}/refund` : undefined}
      >
        {refundFor && (
          <div className="space-y-4">
            <ApprovalNotice
              action="payment.refund"
              extra="Eşik üstü (varsayılan > ₺5.000) ve toplu iadelerde onay SUPER_ADMIN'den alınır."
            />
            <PendingEndpointNotice
              endpoint={`/payments/${refundFor.id}/refund`}
              phase="Faz 3"
              method="POST"
            />
            <Card bodyClassName="p-4">
              <DataRow label="Tenant">{refundFor.tenantName}</DataRow>
              <DataRow label="Tutar">{fmtMoney(refundFor.amount, refundFor.currency)}</DataRow>
              <DataRow label="Sağlayıcı">
                {refundFor.provider} · <span className="font-mono text-xs">{refundFor.providerRef}</span>
              </DataRow>
            </Card>
            <Field label="İade tipi" required>
              <Select defaultValue="tam">
                <option value="tam">Tam iade</option>
                <option value="kismi">Kısmi iade</option>
              </Select>
            </Field>
            <Field label="Gerekçe" required hint="Zorunlu — talep BEKLIYOR durumunda kuyruğa düşer.">
              <Textarea rows={3} placeholder="Örn. yıllık ücret yanlış tahsil edildi; sözleşme aylık faturalamayı öngörüyor." />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRefundFor(null)}>
                Vazgeç
              </Button>
              <Button disabled title="Uç henüz uygulanmadı">
                Onaya gönder
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** 🔒 ANALYST_READONLY — yalnız MRR/churn özetleri; tekil ödeme detayı asla. */
function MaskedPaymentsView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tahsilat Özeti"
        description="Analist rolünde tekil ödeme kaydı, tenant adı ve sağlayıcı referansı gösterilmez."
      />
      <InfoBox title="Maskeli görünüm (🔒)">
        Bu rolde yalnız toplulaştırılmış MRR/churn özetleri görünür. Ödeme detayı, fatura ve iade
        akışı kapalıdır; ilgili mutasyon uçları API katmanında 403 döner.
      </InfoBox>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="MRR" value={fmtMoney(MOCK_OVERVIEW.mrr)} tone="accent" />
        <StatCard label="ARR" value={fmtMoney(MOCK_OVERVIEW.arr)} />
        <StatCard label="Aylık churn" value={`%${MOCK_OVERVIEW.churnPct}`} />
      </div>
    </div>
  );
}
