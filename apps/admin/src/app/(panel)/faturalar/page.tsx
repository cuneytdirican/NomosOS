"use client";

/**
 * Platform faturaları (Faz 3) — GET /invoices · POST /invoices/:id/mark-paid
 * NomosOS → büro faturaları (abonelik dönemi, kredi paketi, plan farkı). Havale/EFT ile
 * ödenen fatura "Ödendi işaretle" ile kesinleşir: kredi yüklenir / abonelik dönemi ilerler.
 */

import { useState } from "react";
import Link from "next/link";
import { useListResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { EP } from "@/lib/endpoints";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_TONES, fmtDate, fmtMoney, labelOf, toneOf } from "@/lib/labels";
import type { AdminInvoiceRecord } from "@/lib/types";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, ResourceView, Select, SuccessBox, Table, Textarea, type Column } from "@/components/ui";

type Row = AdminInvoiceRecord & { type?: string; description?: string | null; dueDate?: string | null; paidAt?: string | null };
const TYPE_LABEL: Record<string, string> = { ABONELIK: "Abonelik dönemi", KREDI_PAKETI: "Kredi paketi", PLAN_FARKI: "Plan farkı" };
const UNPAID = ["TASLAK", "GONDERILDI", "KISMI_ODENDI"];

export default function FaturalarPage() {
  return (
    <PageGate action="invoice.view">
      <Invoices />
    </PageGate>
  );
}

function Invoices() {
  const [status, setStatus] = useState("");
  const res = useListResource<Row>(EP.invoices.list, { query: { status: status || undefined } });
  const mutation = useMutation();
  const [marking, setMarking] = useState<Row | null>(null);
  const [form, setForm] = useState({ method: "HAVALE", reference: "", note: "" });

  async function markPaid() {
    if (!marking) return;
    const ok = await mutation.run(EP.invoices.markPaid(marking.id), { method: "POST", body: form }, { successMessage: "Fatura ödendi olarak kesinleştirildi." });
    if (ok) {
      setMarking(null);
      setForm({ method: "HAVALE", reference: "", note: "" });
      res.reload();
    }
  }

  const columns: Array<Column<Row>> = [
    { key: "number", header: "No", render: (r) => <span className="font-mono text-xs">{r.number ?? "—"}</span> },
    { key: "tenant", header: "Tenant", render: (r) => <Link href={`/tenantlar/${r.tenantId}`} className="text-steel-50 hover:text-accent-300">{r.tenantName ?? r.tenantId}</Link> },
    { key: "type", header: "Tür", render: (r) => (r.type ? TYPE_LABEL[r.type] ?? r.type : "—") },
    { key: "desc", header: "Açıklama", render: (r) => <span className="text-xs text-steel-400">{r.description ?? "—"}</span> },
    { key: "issue", header: "Tarih", render: (r) => fmtDate(r.issueDate) },
    { key: "due", header: "Vade", render: (r) => (r.dueDate ? fmtDate(r.dueDate) : "—") },
    { key: "total", header: "Toplam", align: "right", render: (r) => <span className="font-mono">{fmtMoney(r.total, "TRY")}</span> },
    { key: "status", header: "Durum", render: (r) => <Badge tone={toneOf(INVOICE_STATUS_TONES, r.status)}>{labelOf(INVOICE_STATUS_LABELS, r.status)}</Badge> },
    {
      key: "actions",
      header: "",
      render: (r) =>
        UNPAID.includes(r.status) ? (
          <RoleGate action="invoice.issue" mutation>
            <Button size="sm" variant="ghost" onClick={() => setMarking(r)}>Ödendi işaretle</Button>
          </RoleGate>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Faturaları"
        description="NomosOS → büro faturaları. Dönem faturaları dönem bitiminden 7 gün önce otomatik kesilir; kartla ödeme sağlayıcı üzerinden, havale/EFT buradan kesinleştirilir."
        action={
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tüm durumlar</option>
            <option value="GONDERILDI">Ödeme bekliyor</option>
            <option value="ODENDI">Ödendi</option>
            <option value="TASLAK">Taslak</option>
          </Select>
        }
      />
      {mutation.error && <ErrorBox message={mutation.error} />}
      {mutation.success && <SuccessBox message={mutation.success} />}
      <Card>
        <ResourceView loading={res.loading} missing={res.missing} forbidden={res.forbidden} error={res.error} empty={res.empty} endpoint={EP.invoices.list} what="Platform faturaları">
          <Table columns={columns} rows={res.data} rowKey={(r) => r.id} empty="Fatura yok." />
        </ResourceView>
      </Card>

      <Modal open={marking !== null} title={`Ödendi işaretle — ${marking?.number ?? ""}`} onClose={() => setMarking(null)}>
        <div className="space-y-3">
          <p className="text-sm text-steel-300">
            {marking?.tenantName} · {marking ? fmtMoney(marking.total, "TRY") : ""}. Kesinleştirme kredi yükler ya da abonelik dönemini ilerletir; geri alınamaz.
          </p>
          <Field label="Yöntem">
            <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="HAVALE">Havale / EFT</option>
              <option value="NAKIT">Nakit</option>
              <option value="DIGER">Diğer</option>
            </Select>
          </Field>
          <Field label="Dekont / referans" required>
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Banka dekont no" />
          </Field>
          <Field label="Not">
            <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setMarking(null)}>Vazgeç</Button>
            <Button onClick={() => void markPaid()} disabled={mutation.loading || form.reference.length < 2}>Kesinleştir</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
