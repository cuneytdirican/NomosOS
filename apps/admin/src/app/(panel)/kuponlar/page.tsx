"use client";

/**
 * Kuponlar (Faz 3) — GET /coupons · POST /coupons · PATCH /coupons/:id
 * Yüzde ya da sabit tutar; kapsam TUM / ABONELIK / KREDI; tarih aralığı ve kullanım sınırı.
 * Kullanım sayacı ödeme kesinleşince artar.
 */

import { useState } from "react";
import { useListResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { EP } from "@/lib/endpoints";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { fmtDate } from "@/lib/labels";
import type { AdminCoupon } from "@/lib/types";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, ResourceView, Select, SuccessBox, Table, Textarea, type Column } from "@/components/ui";

const SCOPE_LABEL: Record<AdminCoupon["appliesTo"], string> = { TUM: "Abonelik + kredi", ABONELIK: "Yalnız abonelik", KREDI: "Yalnız kredi paketi" };

export default function KuponlarPage() {
  return (
    <PageGate action="coupon.view">
      <Coupons />
    </PageGate>
  );
}

function Coupons() {
  const res = useListResource<AdminCoupon>(EP.coupons.list);
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: "", kind: "YUZDE", value: "10", appliesTo: "TUM", validUntil: "", maxRedemptions: "", note: "" });

  async function create() {
    const ok = await mutation.run(
      EP.coupons.create,
      {
        method: "POST",
        body: {
          code: form.code,
          kind: form.kind,
          value: Number(form.value),
          appliesTo: form.appliesTo,
          validUntil: form.validUntil || null,
          maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
          note: form.note || null,
        },
      },
      { successMessage: "Kupon oluşturuldu." },
    );
    if (ok) {
      setCreating(false);
      setForm({ code: "", kind: "YUZDE", value: "10", appliesTo: "TUM", validUntil: "", maxRedemptions: "", note: "" });
      res.reload();
    }
  }

  async function toggle(c: AdminCoupon) {
    const ok = await mutation.run(EP.coupons.patch(c.id), { method: "PATCH", body: { isActive: !c.isActive } }, { successMessage: c.isActive ? "Kupon devre dışı bırakıldı." : "Kupon etkinleştirildi." });
    if (ok) res.reload();
  }

  const columns: Array<Column<AdminCoupon>> = [
    { key: "code", header: "Kod", render: (c) => <span className="font-mono">{c.code}</span> },
    { key: "label", header: "İndirim", render: (c) => c.label },
    { key: "scope", header: "Kapsam", render: (c) => SCOPE_LABEL[c.appliesTo] },
    { key: "valid", header: "Geçerlilik", render: (c) => `${c.validFrom ? fmtDate(c.validFrom) : "—"} → ${c.validUntil ? fmtDate(c.validUntil) : "süresiz"}` },
    { key: "usage", header: "Kullanım", align: "right", render: (c) => `${c.redeemedCount}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}` },
    { key: "active", header: "Durum", render: (c) => <Badge tone={c.isActive ? "green" : "steel"}>{c.isActive ? "Aktif" : "Pasif"}</Badge> },
    {
      key: "actions",
      header: "",
      render: (c) => (
        <RoleGate action="coupon.manage" mutation>
          <Button size="sm" variant="ghost" onClick={() => void toggle(c)} disabled={mutation.loading}>
            {c.isActive ? "Pasifleştir" : "Etkinleştir"}
          </Button>
        </RoleGate>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kuponlar"
        description="Abonelik ve kredi paketi indirimleri. BYO-LLM %30 indirimi otomatiktir; kuponla birleşmez (büyük olan uygulanır)."
        action={
          <RoleGate action="coupon.manage" mutation>
            <Button onClick={() => setCreating(true)}>+ Yeni kupon</Button>
          </RoleGate>
        }
      />
      {mutation.error && <ErrorBox message={mutation.error} />}
      {mutation.success && <SuccessBox message={mutation.success} />}
      <Card>
        <ResourceView loading={res.loading} missing={res.missing} forbidden={res.forbidden} error={res.error} empty={res.empty} endpoint={EP.coupons.list} what="Kupon listesi">
          <Table columns={columns} rows={res.data} rowKey={(c) => c.id} empty="Henüz kupon yok." />
        </ResourceView>
      </Card>

      <Modal open={creating} title="Yeni kupon" onClose={() => setCreating(false)}>
        <div className="space-y-3">
          <Field label="Kod" required hint="3-32 karakter; A-Z, 0-9, _ ve -">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="HOSGELDIN25" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tür">
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="YUZDE">Yüzde (%)</option>
                <option value="SABIT">Sabit tutar (TRY)</option>
              </Select>
            </Field>
            <Field label="Değer" required>
              <Input type="number" min={0} step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </Field>
          </div>
          <Field label="Kapsam">
            <Select value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}>
              <option value="TUM">Abonelik + kredi paketi</option>
              <option value="ABONELIK">Yalnız abonelik</option>
              <option value="KREDI">Yalnız kredi paketi</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Son geçerlilik" hint="Boş = süresiz">
              <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </Field>
            <Field label="Kullanım sınırı" hint="Boş = sınırsız">
              <Input type="number" min={1} value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} />
            </Field>
          </div>
          <Field label="Not">
            <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>Vazgeç</Button>
            <Button onClick={() => void create()} disabled={mutation.loading || form.code.length < 3 || !form.value}>Oluştur</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
