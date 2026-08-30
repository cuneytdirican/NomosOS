"use client";

/**
 * Tenant listesi — GET /api/admin/v1/tenants?q=&status=&plan=
 * Filtreleme SUNUCUDA yapılır; panel yalnız sorgu parametresi geçirir.
 *
 * ANALYST_READONLY (🔒) için tenant listesi maskelidir: büro adı, e-posta ve tekil
 * sayaçlar gösterilmez; yalnız plan/durum agregatı görünür.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useListResource } from "@/lib/useResource";
import { useDebounced } from "@/lib/useDebounced";
import { useAdminSession } from "@/lib/session";
import { EP } from "@/lib/endpoints";
import { isMasked } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import {
  PLAN_LABELS,
  PLAN_TONES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_TONES,
  fmtBytes,
  fmtCompact,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  labelOf,
  toneOf,
} from "@/lib/labels";
import { exportCsv } from "@/lib/csv";
import type { AdminTenantRow } from "@/lib/types";
import {
  Badge,
  BarList,
  Button,
  Card,
  Field,
  InfoBox,
  Input,
  PageHeader,
  ResourceView,
  Select,
  Table,
  type Column,
} from "@/components/ui";

const KNOWN_PLANS = ["SOLO", "BURO", "ENTERPRISE"];

export default function TenantlarPage() {
  return (
    <PageGate action="tenant.view">
      <TenantList />
    </PageGate>
  );
}

function TenantList() {
  const { role } = useAdminSession();
  const masked = isMasked(role, "tenant.view");

  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const q = useDebounced(search);

  const res = useListResource<AdminTenantRow>(EP.tenants.list, {
    query: { q: q || undefined, plan: plan || undefined, status: status || undefined },
  });

  const planOptions = useMemo(() => {
    const set = new Set<string>(KNOWN_PLANS);
    for (const t of res.data) if (t.planKey) set.add(t.planKey);
    return [...set];
  }, [res.data]);

  const columns: Array<Column<AdminTenantRow>> = [
    {
      key: "name",
      header: "Büro",
      render: (t) => (
        <div>
          <Link
            href={`/tenantlar/${t.id}`}
            className="font-medium text-steel-50 hover:text-accent-300"
          >
            {t.name}
          </Link>
          <p className="font-mono text-[11px] text-steel-600">{t.id}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan / Durum",
      render: (t) => (
        <div className="flex flex-wrap gap-1.5">
          {t.planKey ? (
            <Badge tone={toneOf(PLAN_TONES, t.planKey)}>{labelOf(PLAN_LABELS, t.planKey)}</Badge>
          ) : (
            <span className="text-xs text-steel-600">abonelik yok</span>
          )}
          {t.status && (
            <Badge tone={toneOf(SUBSCRIPTION_STATUS_TONES, t.status)}>
              {labelOf(SUBSCRIPTION_STATUS_LABELS, t.status)}
            </Badge>
          )}
        </div>
      ),
    },
    { key: "seats", header: "Koltuk", align: "right", render: (t) => fmtNumber(t.seats) },
    { key: "users", header: "Kullanıcı", align: "right", render: (t) => fmtNumber(t.userCount) },
    { key: "cases", header: "Dosya", align: "right", render: (t) => fmtNumber(t.caseCount) },
    { key: "storage", header: "Depo", align: "right", render: (t) => fmtBytes(t.storageBytes) },
    {
      key: "ai",
      header: "AI çağrısı",
      align: "right",
      render: (t) => <span className="font-mono text-steel-200">{fmtCompact(t.aiCallCount)}</span>,
    },
    { key: "mrr", header: "MRR", align: "right", render: (t) => fmtMoney(t.mrr) },
    {
      key: "last",
      header: "Son aktivite",
      render: (t) => (
        <span className="text-xs text-steel-400">{fmtDateTime(t.lastActivityAt)}</span>
      ),
    },
  ];

  if (masked) return <MaskedTenantView state={res} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenantlar"
        description="Hukuk bürolarının platform kaydı. Panel yalnız sayaç ve üstveri görür; müvekkil, dosya ve belge içeriğine erişimi yoktur."
        action={
          <Button
            variant="secondary"
            disabled={res.data.length === 0}
            onClick={() =>
              exportCsv("tenantlar", res.data, [
                { key: "id", header: "Tenant ID", value: (t) => t.id },
                { key: "name", header: "Büro", value: (t) => t.name },
                { key: "plan", header: "Plan", value: (t) => t.planKey ?? "" },
                { key: "status", header: "Durum", value: (t) => t.status ?? "" },
                { key: "seats", header: "Koltuk", value: (t) => t.seats ?? "" },
                { key: "users", header: "Kullanıcı", value: (t) => t.userCount ?? "" },
                { key: "cases", header: "Dosya", value: (t) => t.caseCount ?? "" },
                { key: "storage", header: "Depolama (bayt)", value: (t) => String(t.storageBytes ?? "") },
                { key: "ai", header: "AI çağrısı", value: (t) => t.aiCallCount ?? "" },
                { key: "mrr", header: "MRR", value: (t) => String(t.mrr ?? "") },
              ])
            }
          >
            CSV dışa aktar
          </Button>
        }
      />

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Arama" hint="Sunucuya ?q= olarak gönderilir.">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Büro adı veya tenant kimliği"
            />
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
          <Field label="Abonelik durumu">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tümü</option>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUBSCRIPTION_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                setSearch("");
                setPlan("");
                setStatus("");
              }}
            >
              Filtreleri temizle
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title={res.loaded ? `${res.data.length} tenant` : "Tenantlar"}
        subtitle="Büro adına tıklayarak detay sekmelerine geçebilirsiniz."
      >
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.empty}
          endpoint={EP.tenants.list}
          what="Tenant listesi"
          emptyMessage="Filtrelere uyan tenant bulunamadı."
        >
          <Table columns={columns} rows={res.data} rowKey={(t) => t.id} dense />
        </ResourceView>
      </Card>
    </div>
  );
}

/** 🔒 ANALYST_READONLY görünümü — büro adı, e-posta ve tekil sayaç yoktur. */
function MaskedTenantView({
  state,
}: {
  state: ReturnType<typeof useListResource<AdminTenantRow>>;
}) {
  const byPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of state.data) map.set(t.planKey ?? "—", (map.get(t.planKey ?? "—") ?? 0) + 1);
    return [...map.entries()].map(([plan, count]) => ({ plan, count }));
  }, [state.data]);

  const byStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of state.data) map.set(t.status ?? "—", (map.get(t.status ?? "—") ?? 0) + 1);
    return [...map.entries()].map(([status, count]) => ({ status, count }));
  }, [state.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenant Dağılımı"
        description="Analist rolünde tenant listesi maskelidir: yalnız plan ve durum agregatı gösterilir."
      />
      <InfoBox title="Maskeli görünüm (🔒)">
        Büro adı, e-posta, müvekkil ve dosya verisi bu rolde <strong>hiçbir koşulda</strong>{" "}
        gösterilmez; sunucu da bu alanları döndürmez. Bu rolde hiçbir yazma düğmesi render edilmez
        ve mutasyon uçları 403 verir.
      </InfoBox>
      <ResourceView
        loading={state.loading}
        missing={state.missing}
        forbidden={state.forbidden}
        error={state.error}
        empty={state.empty}
        endpoint={EP.tenants.list}
        what="Tenant dağılımı"
        emptyMessage="Gösterilecek tenant kaydı yok."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Plan dağılımı">
            <BarList
              items={byPlan.map((p) => ({
                label: labelOf(PLAN_LABELS, p.plan),
                value: p.count,
                hint: `${p.count} tenant`,
              }))}
            />
          </Card>
          <Card title="Abonelik durumu dağılımı">
            <BarList
              items={byStatus.map((s) => ({
                label: labelOf(SUBSCRIPTION_STATUS_LABELS, s.status),
                value: s.count,
                hint: `${s.count} tenant`,
                tone: "green" as const,
              }))}
            />
          </Card>
        </div>
      </ResourceView>
    </div>
  );
}
