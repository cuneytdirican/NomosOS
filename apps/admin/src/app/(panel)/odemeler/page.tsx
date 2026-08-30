"use client";

/**
 * Ödemeler — PLATFORM tahsilatı (PaymentRecord).
 * Tenant'ın müvekkiline kestiği fatura/ödeme (Modül 09) ile karıştırılmamalıdır.
 *
 * Uçlar: GET /payments?status= · GET /payments/failed · POST /payments/:id/refund
 * İade dört-göz kapsamındadır: sunucu doğrudan uygulamaz, onay talebi döndürür.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useListResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { useAdminSession } from "@/lib/session";
import { EP } from "@/lib/endpoints";
import { isMasked } from "@/lib/rbac";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalNotice } from "@/components/ApprovalBadge";
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  PLATFORM_PAYMENT_STATUSES,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  labelOf,
  toneOf,
} from "@/lib/labels";
import { exportCsv } from "@/lib/csv";
import type { AdminPaymentRecord } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  DataRow,
  EndpointMissingNotice,
  ErrorBox,
  Field,
  InfoBox,
  Input,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  StatCard,
  SuccessBox,
  Table,
  Tabs,
  Textarea,
  WarningBox,
  type Column,
} from "@/components/ui";

type TabKey = "odemeler" | "basarisiz";

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
  const [refundFor, setRefundFor] = useState<AdminPaymentRecord | null>(null);

  const payments = useListResource<AdminPaymentRecord>(EP.payments.list, {
    query: { status: statusFilter || undefined },
  });
  const failed = useListResource<AdminPaymentRecord>(EP.payments.failed);

  /** SUPPORT_AGENT yalnız "ödendi/ödenmedi" görür — tutar ve sağlayıcı referansı gizlenir. */
  const limited = role === "SUPPORT_AGENT";

  const succeededTotalKnown = useMemo(
    () => payments.data.filter((p) => p.status === "BASARILI").length,
    [payments.data],
  );

  if (isMasked(role, "payment.view")) return <MaskedPaymentsView />;

  const paymentColumns: Array<Column<AdminPaymentRecord>> = [
    {
      key: "tenant",
      header: "Tenant",
      render: (p) => (
        <Link href={`/tenantlar/${p.tenantId}`} className="text-steel-50 hover:text-accent-300">
          {p.tenantName ?? p.tenantId}
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
          <span className="font-mono">{fmtMoney(p.amount, p.currency ?? "TRY")}</span>
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
    { key: "method", header: "Yöntem", render: (p) => p.method ?? "—" },
    {
      key: "provider",
      header: "Sağlayıcı referansı",
      render: (p) =>
        limited ? (
          <span className="text-steel-500">—</span>
        ) : (
          <span className="font-mono text-xs text-steel-400">{p.providerRef ?? "—"}</span>
        ),
    },
    { key: "created", header: "Oluşturma", render: (p) => fmtDateTime(p.createdAt) },
    { key: "paid", header: "Ödeme", render: (p) => fmtDateTime(p.paidAt) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (p) =>
        p.status === "BASARILI" ? (
          <RoleGate action="payment.refund" mutation>
            <Button size="sm" variant="secondary" onClick={() => setRefundFor(p)}>
              İade talebi
            </Button>
          </RoleGate>
        ) : null,
    },
  ];

  const failedColumns: Array<Column<AdminPaymentRecord>> = [
    {
      key: "tenant",
      header: "Tenant",
      render: (p) => (
        <Link href={`/tenantlar/${p.tenantId}`} className="text-steel-50 hover:text-accent-300">
          {p.tenantName ?? p.tenantId}
        </Link>
      ),
    },
    {
      key: "amount",
      header: "Tutar",
      align: "right",
      render: (p) =>
        limited ? "—" : <span className="font-mono">{fmtMoney(p.amount, p.currency ?? "TRY")}</span>,
    },
    {
      key: "reason",
      header: "Hata",
      render: (p) => <span className="text-steel-200">{p.failureReason ?? "—"}</span>,
    },
    { key: "attempt", header: "Deneme", align: "right", render: (p) => fmtNumber(p.attempt) },
    { key: "created", header: "Son deneme", render: (p) => fmtDateTime(p.createdAt) },
  ];

  const activeList = tab === "odemeler" ? payments : failed;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ödemeler"
        description="Platform tahsilatı: abonelik ödemeleri, başarısız ödeme kuyruğu ve iade akışı."
        action={
          !limited ? (
            <Button
              variant="secondary"
              disabled={activeList.data.length === 0}
              onClick={() =>
                exportCsv("odemeler", activeList.data, [
                  { key: "id", header: "Ödeme ID", value: (p) => p.id },
                  { key: "tenantId", header: "Tenant ID", value: (p) => p.tenantId },
                  { key: "tenant", header: "Tenant", value: (p) => p.tenantName ?? "" },
                  { key: "amount", header: "Tutar", value: (p) => String(p.amount ?? "") },
                  { key: "currency", header: "Para birimi", value: (p) => p.currency ?? "TRY" },
                  { key: "status", header: "Durum", value: (p) => p.status },
                  { key: "method", header: "Yöntem", value: (p) => p.method ?? "" },
                  { key: "ref", header: "Sağlayıcı referansı", value: (p) => p.providerRef ?? "" },
                  { key: "createdAt", header: "Oluşturma", value: (p) => p.createdAt },
                  { key: "paidAt", header: "Ödeme", value: (p) => p.paidAt ?? "" },
                ])
              }
            >
              CSV dışa aktar
            </Button>
          ) : undefined
        }
      />

      {limited && (
        <InfoBox title="Salt-okur destek görünümü (👁)">
          Destek rolünde yalnız <strong>ödendi/ödenmedi</strong> bilgisi görünür; tutar ve sağlayıcı
          referansı gizlenir. Her ödeme detayı görüntülemesi PlatformAuditLog&apos;a yazılır.
        </InfoBox>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Başarısız ödeme"
          value={failed.loaded ? fmtNumber(failed.data.length) : "—"}
          tone={failed.data.length > 0 ? "red" : "steel"}
          hint="tahsilat kuyruğunda"
        />
        <StatCard
          label="Başarılı ödeme (listede)"
          value={payments.loaded ? fmtNumber(succeededTotalKnown) : "—"}
        />
        <StatCard
          label="Toplam kayıt"
          value={payments.loaded ? fmtNumber(payments.data.length) : "—"}
        />
      </div>

      <Tabs
        tabs={[
          { key: "odemeler", label: "Ödeme kayıtları", count: payments.data.length },
          { key: "basarisiz", label: "Başarısız", count: failed.data.length },
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
                  {PLATFORM_PAYMENT_STATUSES.map((s) => (
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
          <Card title={payments.loaded ? `${payments.data.length} ödeme kaydı` : "Ödeme kayıtları"}>
            <ResourceView
              loading={payments.loading}
              missing={payments.missing}
              forbidden={payments.forbidden}
              error={payments.error}
              empty={payments.empty}
              endpoint={EP.payments.list}
              what="Ödeme kayıtları"
              emptyMessage="Filtrelere uyan ödeme kaydı yok."
            >
              <Table columns={paymentColumns} rows={payments.data} rowKey={(p) => p.id} dense />
            </ResourceView>
          </Card>
        </>
      )}

      {tab === "basarisiz" && (
        <>
          <WarningBox title="Tahsilat zinciri">
            e-posta → uyarı → askıya alma. Askıya alma zincirin <strong>son</strong> adımıdır ve
            dört-göz onayı gerektirir; <code className="font-mono">PAST_DUE → SUSPENDED</code>{" "}
            geçişi sunucudaki tolerans süresi ayarına bağlıdır.
          </WarningBox>
          <Card title={failed.loaded ? `${failed.data.length} başarısız ödeme` : "Başarısız ödemeler"}>
            <ResourceView
              loading={failed.loading}
              missing={failed.missing}
              forbidden={failed.forbidden}
              error={failed.error}
              empty={failed.empty}
              endpoint={EP.payments.failed}
              what="Başarısız ödeme kuyruğu"
              emptyMessage="Başarısız ödeme yok."
            >
              <Table columns={failedColumns} rows={failed.data} rowKey={(p) => p.id} dense />
            </ResourceView>
          </Card>
        </>
      )}

      {refundFor && (
        <RefundModal
          payment={refundFor}
          onClose={() => setRefundFor(null)}
          onSaved={() => {
            payments.reload();
            failed.reload();
          }}
        />
      )}
    </div>
  );
}

function RefundModal({
  payment,
  onClose,
  onSaved,
}: {
  payment: AdminPaymentRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const mutation = useMutation();

  async function submit() {
    const body: Record<string, unknown> = { reason: reason.trim() };
    // Kısmi iadede tutar STRING olarak gönderilir; istemcide float aritmetiği yapılmaz.
    if (partial && amount.trim()) body.amount = amount.trim();

    const ok = await mutation.run(
      EP.payments.refund(payment.id),
      { method: "POST", body },
      { successMessage: "İade işlemi uygulandı.", onSuccess: onSaved },
    );
    if (ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="İade talebi"
      subtitle={`POST /api/admin/v1${EP.payments.refund(payment.id)}`}
    >
      <div className="space-y-4">
        <ApprovalNotice
          action="payment.refund"
          extra="İade dört-göz listesindedir; talep BEKLIYOR durumunda kuyruğa düşer ve farklı bir yetkili onaylar."
        />

        <Card bodyClassName="p-4">
          <DataRow label="Tenant">{payment.tenantName ?? payment.tenantId}</DataRow>
          <DataRow label="Tutar">{fmtMoney(payment.amount, payment.currency ?? "TRY")}</DataRow>
          <DataRow label="Sağlayıcı referansı">
            <span className="font-mono text-xs">{payment.providerRef ?? "—"}</span>
          </DataRow>
        </Card>

        <Field label="İade tipi" required>
          <Select
            value={partial ? "kismi" : "tam"}
            onChange={(e) => setPartial(e.target.value === "kismi")}
          >
            <option value="tam">Tam iade</option>
            <option value="kismi">Kısmi iade</option>
          </Select>
        </Field>

        {partial && (
          <Field
            label="İade tutarı"
            required
            hint="Kuruş ayracı nokta ile yazılır (ör. 1250.00). Tutar sunucuda Decimal olarak işlenir."
          >
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="1250.00"
            />
          </Field>
        )}

        <Field label="Gerekçe" required>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Örn. yıllık ücret yanlış tahsil edildi; sözleşme aylık faturalamayı öngörüyor."
          />
        </Field>

        {mutation.missing && (
          <EndpointMissingNotice
            endpoint={EP.payments.refund(payment.id)}
            method="POST"
            what="İade talebi"
          />
        )}
        {mutation.error && <ErrorBox message={mutation.error} />}
        {mutation.success && <SuccessBox message={mutation.success} />}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button
            disabled={
              reason.trim().length === 0 ||
              (partial && amount.trim().length === 0) ||
              mutation.loading
            }
            onClick={() => void submit()}
          >
            {mutation.loading ? "Gönderiliyor…" : "Onaya gönder"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** 🔒 ANALYST_READONLY — tekil ödeme kaydı ve tenant kimliği asla gösterilmez. */
function MaskedPaymentsView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tahsilat"
        description="Analist rolünde tekil ödeme kaydı, tenant adı ve sağlayıcı referansı gösterilmez."
      />
      <InfoBox title="Maskeli görünüm (🔒)">
        Bu rolde ödeme detayı, fatura ve iade akışı kapalıdır; sunucu tekil kayıt döndürmez ve
        mutasyon uçları 403 verir. Toplulaştırılmış MRR/churn göstergeleri{" "}
        <Link href="/" className="text-accent-300 underline">
          Yatırımcı Görünümü
        </Link>{" "}
        ekranındadır.
      </InfoBox>
    </div>
  );
}
