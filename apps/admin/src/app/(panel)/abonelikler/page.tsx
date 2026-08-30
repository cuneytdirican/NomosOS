"use client";

/**
 * Abonelikler — durum makinesi rozetleri, yaklaşan yenilemeler, biten denemeler,
 * plan değişikliği (dört-göz uyarısıyla) ve durum geçişi.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useResource } from "@/lib/useResource";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalNotice } from "@/components/ApprovalBadge";
import {
  BILLING_CYCLE_LABELS,
  PLAN_CODES,
  PLAN_LABELS,
  PLAN_TONES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_TONES,
  SUBSCRIPTION_TRANSITIONS,
  fmtDate,
  fmtMoney,
  labelOf,
  toneOf,
  type SubscriptionStatus,
} from "@/lib/labels";
import { MOCK_SUBSCRIPTIONS, type AdminSubscription } from "@/lib/mock";
import {
  Badge,
  Button,
  Card,
  Field,
  InfoBox,
  MockBadge,
  Modal,
  PageHeader,
  PendingEndpointNotice,
  Select,
  StatCard,
  Table,
  Textarea,
  type Column,
} from "@/components/ui";

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
  const [transitionFor, setTransitionFor] = useState<AdminSubscription | null>(null);
  const [planChangeFor, setPlanChangeFor] = useState<AdminSubscription | null>(null);
  const [targetStatus, setTargetStatus] = useState<string>("");

  const res = useResource<AdminSubscription[]>("/subscriptions", [...MOCK_SUBSCRIPTIONS], {
    query: { status: status || undefined, plan: plan || undefined },
  });

  const rows = useMemo(
    () =>
      res.data.filter((s) => {
        if (status && s.status !== status) return false;
        if (plan && s.plan !== plan) return false;
        return true;
      }),
    [res.data, status, plan],
  );

  const counters = useMemo(() => {
    const total = res.data.length;
    const pastDue = res.data.filter((s) => s.status === "PAST_DUE").length;
    const trials = res.data.filter((s) => s.status === "TRIAL").length;
    const suspended = res.data.filter((s) => s.status === "SUSPENDED").length;
    const mrr = res.data.reduce((a, s) => a + s.mrr, 0);
    return { total, pastDue, trials, suspended, mrr };
  }, [res.data]);

  const columns: Array<Column<AdminSubscription>> = [
    {
      key: "tenant",
      header: "Tenant",
      render: (s) => (
        <div>
          <Link href={`/tenantlar/${s.tenantId}`} className="font-medium text-steel-50 hover:text-accent-300">
            {s.tenantName}
          </Link>
          <p className="text-xs text-steel-500">#{s.tenantCode}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      render: (s) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Badge tone={toneOf(PLAN_TONES, s.plan)}>{labelOf(PLAN_LABELS, s.plan)}</Badge>
          {s.customPrice && (
            <Badge tone="accent" title="Özel fiyat — dört-göz onayıyla tanımlandı.">
              özel
            </Badge>
          )}
        </span>
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
    { key: "cycle", header: "Döngü", render: (s) => labelOf(BILLING_CYCLE_LABELS, s.billingCycle) },
    {
      key: "period",
      header: "Dönem",
      render: (s) => (
        <span className="text-xs text-steel-400">
          {fmtDate(s.currentPeriodStart)} → {fmtDate(s.currentPeriodEnd)}
        </span>
      ),
    },
    {
      key: "trial",
      header: "Deneme bitişi",
      render: (s) => (s.trialEndsAt ? fmtDate(s.trialEndsAt) : "—"),
    },
    { key: "mrr", header: "MRR", align: "right", render: (s) => fmtMoney(s.mrr) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (s) => (
        <div className="flex justify-end gap-2">
          <RoleGate action="subscription.transition" mutation>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setTransitionFor(s);
                setTargetStatus("");
              }}
            >
              Durum geçişi
            </Button>
          </RoleGate>
          <RoleGate action="tenant.plan_change" mutation>
            <Button size="sm" variant="secondary" onClick={() => setPlanChangeFor(s)}>
              Plan
            </Button>
          </RoleGate>
        </div>
      ),
    },
  ];

  const allowedTargets: SubscriptionStatus[] = transitionFor
    ? (SUBSCRIPTION_TRANSITIONS[transitionFor.status as SubscriptionStatus] ?? [])
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abonelikler"
        description="Tenant başına tek aktif kayıt. Durum geçişleri yalnız durum makinesi kurallarına uyar; her geçiş PlatformAuditLog'a yazılır."
        action={res.pending ? <MockBadge /> : undefined}
      />

      {res.pending && <PendingEndpointNotice endpoint="/subscriptions" phase="Faz 1" />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Abonelik" value={counters.total} />
        <StatCard label="Toplam MRR" value={fmtMoney(counters.mrr)} tone="accent" />
        <StatCard label="Deneme" value={counters.trials} tone="yellow" />
        <StatCard
          label="Ödeme gecikti"
          value={counters.pastDue}
          tone={counters.pastDue > 0 ? "red" : "steel"}
          hint="dunning kuyruğu"
        />
        <StatCard label="Askıda" value={counters.suspended} tone={counters.suspended > 0 ? "red" : "steel"} />
      </div>

      <Card title="Durum makinesi" subtitle="Geçersiz geçiş API'de 422 döner; CANCELED terminaldir.">
        <div className="overflow-x-auto">
          <ul className="flex min-w-max flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-steel-300">
            <li>TRIAL ──ödeme──▶ ACTIVE</li>
            <li>TRIAL ──süre doldu──▶ SUSPENDED</li>
            <li>ACTIVE ──ödeme başarısız──▶ PAST_DUE</li>
            <li>PAST_DUE ──grace gün──▶ SUSPENDED</li>
            <li>PAST_DUE ──ödeme──▶ ACTIVE</li>
            <li>SUSPENDED ──ödeme/manuel──▶ ACTIVE</li>
            <li>ACTIVE|PAST_DUE|SUSPENDED ──iptal──▶ CANCELED</li>
          </ul>
        </div>
        <p className="mt-3 text-xs text-steel-500">
          <code className="font-mono">PAST_DUE → SUSPENDED</code> geçişi{" "}
          <code className="font-mono">past_due_grace_days</code> ayarına bağlı otomatik cron&apos;dur;
          askıya alma dunning zincirinin son adımıdır.
        </p>
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
              {PLAN_CODES.map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABELS[p]}
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

      <Card title={`${rows.length} abonelik`}>
        <Table columns={columns} rows={rows} rowKey={(s) => s.id} dense />
      </Card>

      {/* Durum geçişi */}
      <Modal
        open={transitionFor !== null}
        onClose={() => setTransitionFor(null)}
        title="Abonelik durum geçişi"
        subtitle={
          transitionFor
            ? `POST /subscriptions/${transitionFor.id}/transition — ${transitionFor.tenantName}`
            : undefined
        }
      >
        {transitionFor && (
          <div className="space-y-4">
            <PendingEndpointNotice
              endpoint={`/subscriptions/${transitionFor.id}/transition`}
              phase="Faz 1"
              method="POST"
            />
            <div className="flex items-center gap-2 text-sm text-steel-300">
              Mevcut durum:
              <Badge tone={toneOf(SUBSCRIPTION_STATUS_TONES, transitionFor.status)}>
                {labelOf(SUBSCRIPTION_STATUS_LABELS, transitionFor.status)}
              </Badge>
            </div>

            {allowedTargets.length === 0 ? (
              <InfoBox>
                Bu durum terminaldir; geçerli bir geçiş yoktur (CANCELED&apos;dan çıkış olmaz).
              </InfoBox>
            ) : (
              <Field label="Hedef durum" required hint="Yalnız durum makinesinin izin verdiği geçişler listelenir.">
                <Select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)}>
                  <option value="">Seçiniz…</option>
                  {allowedTargets.map((s) => (
                    <option key={s} value={s}>
                      {SUBSCRIPTION_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {targetStatus === "SUSPENDED" && (
              <>
                <ApprovalNotice action="tenant.suspend" />
                <p className="text-xs text-steel-500">
                  BILLING_ADMIN yalnız ödeme temerrüdü gerekçesiyle askıya alma talep edebilir.
                </p>
              </>
            )}

            <Field label="Gerekçe" required hint="Zorunlu — PlatformAuditLog('SUBSCRIPTION_TRANSITION') kaydına yazılır.">
              <Textarea rows={3} placeholder="Geçiş gerekçesi…" />
            </Field>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTransitionFor(null)}>
                Vazgeç
              </Button>
              <Button disabled title="Uç henüz uygulanmadı">
                {targetStatus === "SUSPENDED" ? "Onaya gönder" : "Uygula"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Plan değişikliği */}
      <Modal
        open={planChangeFor !== null}
        onClose={() => setPlanChangeFor(null)}
        title="Plan değişikliği"
        subtitle={
          planChangeFor
            ? `POST /subscriptions/${planChangeFor.id}/change-plan — ${planChangeFor.tenantName}`
            : undefined
        }
      >
        {planChangeFor && (
          <div className="space-y-4">
            <PendingEndpointNotice
              endpoint={`/subscriptions/${planChangeFor.id}/change-plan`}
              phase="Faz 3"
              method="POST"
            />
            <Field label="Yeni plan" required>
              <Select defaultValue={planChangeFor.plan}>
                {PLAN_CODES.map((p) => (
                  <option key={p} value={p}>
                    {PLAN_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Özel fiyat (opsiyonel)" hint="Doldurulursa dört-göz onayı gerekir.">
              <Select defaultValue="hayir">
                <option value="hayir">Standart plan fiyatı</option>
                <option value="evet">Özel fiyat / manuel indirim</option>
              </Select>
            </Field>
            <div className="flex items-center gap-2">
              <ApprovalBadge action="tenant.custom_price" force />
              <span className="text-xs text-steel-400">
                Özel fiyat ve manuel indirim dört-göz listesindedir.
              </span>
            </div>
            <Field label="Gerekçe" required>
              <Textarea rows={3} placeholder="Sözleşme referansı, indirim gerekçesi…" />
            </Field>
            <InfoBox>
              Plan fiyat değişikliği mevcut aboneleri cari dönem sonuna kadar etkilemez. Satıştan
              kaldırılan plan pasife çekilir; mevcut aboneler korunur.
            </InfoBox>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPlanChangeFor(null)}>
                Vazgeç
              </Button>
              <Button disabled title="Uç henüz uygulanmadı">
                Uygula
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
