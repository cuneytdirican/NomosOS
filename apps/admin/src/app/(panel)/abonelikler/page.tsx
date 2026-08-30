"use client";

/**
 * Abonelikler — GET /subscriptions · PATCH /subscriptions/:id · POST /subscriptions/:id/cancel
 *
 * Durum geçişleri durum makinesine uyar (CANCELED terminaldir). Plan değişikliği ve
 * askıya alma dört-göz kapsamındadır: sunucu doğrudan uygulamaz, onay talebi döndürür.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useListResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { EP } from "@/lib/endpoints";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalNotice } from "@/components/ApprovalBadge";
import {
  PLAN_LABELS,
  PLAN_TONES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_TONES,
  SUBSCRIPTION_TRANSITIONS,
  fmtDate,
  fmtMoney,
  fmtNumber,
  labelOf,
  toneOf,
  type SubscriptionStatus,
} from "@/lib/labels";
import { exportCsv } from "@/lib/csv";
import type { AdminSubscription } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
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
  Textarea,
  type Column,
} from "@/components/ui";

const KNOWN_PLANS = ["SOLO", "BURO", "ENTERPRISE"];

export default function AboneliklerPage() {
  return (
    <PageGate action="subscription.view">
      <Subscriptions />
    </PageGate>
  );
}

function Subscriptions() {
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [editing, setEditing] = useState<AdminSubscription | null>(null);
  const [canceling, setCanceling] = useState<AdminSubscription | null>(null);

  const res = useListResource<AdminSubscription>(EP.subscriptions.list, {
    query: { status: status || undefined, plan: plan || undefined },
  });

  const planOptions = useMemo(() => {
    const set = new Set<string>(KNOWN_PLANS);
    for (const s of res.data) if (s.planKey) set.add(s.planKey);
    return [...set];
  }, [res.data]);

  const counters = useMemo(() => {
    const rows = res.data;
    const count = (st: string) => rows.filter((s) => s.status === st).length;
    return {
      total: rows.length,
      trial: count("TRIAL"),
      pastDue: count("PAST_DUE"),
      suspended: count("SUSPENDED"),
      seats: rows.reduce((a, s) => a + (s.seats ?? 0), 0),
    };
  }, [res.data]);

  const columns: Array<Column<AdminSubscription>> = [
    {
      key: "tenant",
      header: "Tenant",
      render: (s) => (
        <div>
          <Link
            href={`/tenantlar/${s.tenantId}`}
            className="font-medium text-steel-50 hover:text-accent-300"
          >
            {s.tenantName ?? s.tenantId}
          </Link>
          <p className="font-mono text-[11px] text-steel-600">{s.tenantId}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      render: (s) => (
        <Badge tone={toneOf(PLAN_TONES, s.planKey)}>{labelOf(PLAN_LABELS, s.planKey)}</Badge>
      ),
    },
    {
      key: "status",
      header: "Durum",
      render: (s) => (
        <Badge tone={toneOf(SUBSCRIPTION_STATUS_TONES, s.status)}>
          {labelOf(SUBSCRIPTION_STATUS_LABELS, s.status)}
        </Badge>
      ),
    },
    { key: "seats", header: "Koltuk", align: "right", render: (s) => fmtNumber(s.seats) },
    {
      key: "period",
      header: "Dönem",
      render: (s) => (
        <span className="text-xs text-steel-400">
          {fmtDate(s.currentPeriodStart)} → {fmtDate(s.currentPeriodEnd)}
        </span>
      ),
    },
    { key: "trial", header: "Deneme bitişi", render: (s) => fmtDate(s.trialEndsAt) },
    { key: "mrr", header: "MRR", align: "right", render: (s) => fmtMoney(s.mrr) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (s) => (
        <div className="flex justify-end gap-2">
          <RoleGate action="subscription.transition" mutation>
            <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
              Düzenle
            </Button>
          </RoleGate>
          {s.status !== "CANCELED" && (
            <RoleGate action="subscription.transition" mutation>
              <Button size="sm" variant="danger" onClick={() => setCanceling(s)}>
                İptal et
              </Button>
            </RoleGate>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abonelikler"
        description="Tenant başına tek kayıt (Subscription.tenantId benzersizdir). Durum geçişleri durum makinesine uyar; her geçiş PlatformAuditLog'a yazılır."
        action={
          <Button
            variant="secondary"
            disabled={res.data.length === 0}
            onClick={() =>
              exportCsv("abonelikler", res.data, [
                { key: "tenantId", header: "Tenant ID", value: (s) => s.tenantId },
                { key: "tenant", header: "Tenant", value: (s) => s.tenantName ?? "" },
                { key: "plan", header: "Plan", value: (s) => s.planKey },
                { key: "status", header: "Durum", value: (s) => s.status },
                { key: "seats", header: "Koltuk", value: (s) => s.seats ?? "" },
                { key: "start", header: "Dönem başı", value: (s) => s.currentPeriodStart ?? "" },
                { key: "end", header: "Dönem sonu", value: (s) => s.currentPeriodEnd ?? "" },
                { key: "mrr", header: "MRR", value: (s) => String(s.mrr ?? "") },
              ])
            }
          >
            CSV dışa aktar
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Abonelik" value={res.loaded ? fmtNumber(counters.total) : "—"} />
        <StatCard label="Toplam koltuk" value={res.loaded ? fmtNumber(counters.seats) : "—"} tone="accent" />
        <StatCard label="Deneme" value={res.loaded ? fmtNumber(counters.trial) : "—"} tone="yellow" />
        <StatCard
          label="Ödeme gecikti"
          value={res.loaded ? fmtNumber(counters.pastDue) : "—"}
          tone={counters.pastDue > 0 ? "red" : "steel"}
        />
        <StatCard
          label="Askıda"
          value={res.loaded ? fmtNumber(counters.suspended) : "—"}
          tone={counters.suspended > 0 ? "red" : "steel"}
        />
      </div>

      <Card title="Durum makinesi" subtitle="Geçersiz geçişi sunucu reddeder; CANCELED terminaldir.">
        <div className="overflow-x-auto">
          <ul className="flex min-w-max flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-steel-300">
            <li>TRIAL ──ödeme──▶ ACTIVE</li>
            <li>ACTIVE ──ödeme başarısız──▶ PAST_DUE</li>
            <li>PAST_DUE ──grace gün──▶ SUSPENDED</li>
            <li>PAST_DUE ──ödeme──▶ ACTIVE</li>
            <li>SUSPENDED ──ödeme/manuel──▶ ACTIVE</li>
            <li>* ──iptal──▶ CANCELED</li>
          </ul>
        </div>
      </Card>

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Durum">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tümü</option>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUBSCRIPTION_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Plan">
            <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">Tümü</option>
              {planOptions.map((p) => (
                <option key={p} value={p}>
                  {labelOf(PLAN_LABELS, p)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                setStatus("");
                setPlan("");
              }}
            >
              Filtreleri temizle
            </Button>
          </div>
        </div>
      </Card>

      <Card title={res.loaded ? `${res.data.length} abonelik` : "Abonelikler"}>
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.empty}
          endpoint={EP.subscriptions.list}
          what="Abonelik listesi"
          emptyMessage="Filtrelere uyan abonelik bulunamadı."
        >
          <Table columns={columns} rows={res.data} rowKey={(s) => s.id} dense />
        </ResourceView>
      </Card>

      {editing && (
        <EditSubscriptionModal
          subscription={editing}
          planOptions={planOptions}
          onClose={() => setEditing(null)}
          onSaved={() => res.reload()}
        />
      )}

      {canceling && (
        <CancelSubscriptionModal
          subscription={canceling}
          onClose={() => setCanceling(null)}
          onSaved={() => res.reload()}
        />
      )}
    </div>
  );
}

function EditSubscriptionModal({
  subscription,
  planOptions,
  onClose,
  onSaved,
}: {
  subscription: AdminSubscription;
  planOptions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [planKey, setPlanKey] = useState(subscription.planKey);
  const [status, setStatus] = useState(subscription.status);
  const [seats, setSeats] = useState(String(subscription.seats ?? 1));
  const [reason, setReason] = useState("");
  const mutation = useMutation();

  const allowedTargets: SubscriptionStatus[] =
    SUBSCRIPTION_TRANSITIONS[subscription.status as SubscriptionStatus] ?? [];

  const planChanged = planKey !== subscription.planKey;
  const statusChanged = status !== subscription.status;
  const needsApproval = planChanged || status === "SUSPENDED";

  async function submit() {
    const body: Record<string, unknown> = { reason: reason.trim() };
    if (planChanged) body.planKey = planKey;
    if (statusChanged) body.status = status;
    if (Number(seats) !== subscription.seats) body.seats = Number(seats);

    const ok = await mutation.run(
      EP.subscriptions.update(subscription.id),
      { method: "PATCH", body },
      { successMessage: "Abonelik güncellendi.", onSuccess: onSaved },
    );
    if (ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Abonelik düzenle"
      subtitle={`PATCH /api/admin/v1${EP.subscriptions.update(subscription.id)} — ${
        subscription.tenantName ?? subscription.tenantId
      }`}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-steel-300">
          Mevcut durum:
          <Badge tone={toneOf(SUBSCRIPTION_STATUS_TONES, subscription.status)}>
            {labelOf(SUBSCRIPTION_STATUS_LABELS, subscription.status)}
          </Badge>
        </div>

        <Field label="Plan" hint="Plan değişikliği dört-göz onayı gerektirir.">
          <Select value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
            {[...new Set([subscription.planKey, ...planOptions])].map((p) => (
              <option key={p} value={p}>
                {labelOf(PLAN_LABELS, p)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Durum"
          hint="Yalnız durum makinesinin izin verdiği hedefler listelenir; askıya alma dört-göz kapsamındadır."
        >
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value={subscription.status}>
              {labelOf(SUBSCRIPTION_STATUS_LABELS, subscription.status)} (değişiklik yok)
            </option>
            {allowedTargets.map((s) => (
              <option key={s} value={s}>
                {SUBSCRIPTION_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Koltuk sayısı">
          <Input
            type="number"
            min={1}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
          />
        </Field>

        {needsApproval && <ApprovalNotice action={planChanged ? "tenant.plan_change" : "tenant.suspend"} />}
        {needsApproval && (
          <div>
            <ApprovalBadge action={planChanged ? "tenant.custom_price" : "tenant.suspend"} force />
          </div>
        )}

        <Field label="Gerekçe" required hint="Zorunlu — PlatformAuditLog kaydına yazılır.">
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Yükseltme talebi, sözleşme referansı, temerrüt gerekçesi…"
          />
        </Field>

        {mutation.missing && (
          <EndpointMissingNotice
            endpoint={EP.subscriptions.update(subscription.id)}
            method="PATCH"
            what="Abonelik güncelleme"
          />
        )}
        {mutation.error && <ErrorBox message={mutation.error} />}
        {mutation.success && <SuccessBox message={mutation.success} />}

        <InfoBox>
          Plan fiyatı yalnız kayıttan okunur; panel KDV oranı ya da fiyat hesabı yapmaz. Parasal
          hesaplar sunucu tarafında deterministiktir.
        </InfoBox>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button
            disabled={reason.trim().length === 0 || mutation.loading}
            onClick={() => void submit()}
          >
            {mutation.loading ? "Gönderiliyor…" : needsApproval ? "Onaya gönder" : "Kaydet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CancelSubscriptionModal({
  subscription,
  onClose,
  onSaved,
}: {
  subscription: AdminSubscription;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const mutation = useMutation();

  async function submit() {
    const ok = await mutation.run(
      EP.subscriptions.cancel(subscription.id),
      { method: "POST", body: { reason: reason.trim() } },
      { successMessage: "Abonelik iptal edildi.", onSuccess: onSaved },
    );
    if (ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Aboneliği iptal et"
      subtitle={`POST /api/admin/v1${EP.subscriptions.cancel(subscription.id)}`}
    >
      <div className="space-y-4">
        <ApprovalNotice action="tenant.suspend" />
        <InfoBox>
          İptal <strong>terminal</strong> bir geçiştir: CANCELED durumundan çıkış yoktur. Veri
          silinmez; saklama süresi ve imha ayrı bir dört-göz işlemidir.
        </InfoBox>
        <Field label="Gerekçe" required>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Müşteri kapatma talebi, sözleşme feshi…"
          />
        </Field>
        {mutation.missing && (
          <EndpointMissingNotice
            endpoint={EP.subscriptions.cancel(subscription.id)}
            method="POST"
            what="Abonelik iptali"
          />
        )}
        {mutation.error && <ErrorBox message={mutation.error} />}
        {mutation.success && <SuccessBox message={mutation.success} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length === 0 || mutation.loading}
            onClick={() => void submit()}
          >
            {mutation.loading ? "Gönderiliyor…" : "İptal talebini gönder"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
