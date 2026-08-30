"use client";

/**
 * Tenant listesi — arama, plan/durum filtresi, sayaç kolonları.
 * ANALYST_READONLY için (🔒) yalnız plan/segment agregatı gösterilir; büro adı görünmez.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
import { isMasked } from "@/lib/rbac";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalBadge } from "@/components/ApprovalBadge";
import {
  AI_PROVIDER_TYPE_LABELS,
  AI_PROVIDER_TYPE_TONES,
  PLAN_LABELS,
  PLAN_TONES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_TONES,
  PLAN_CODES,
  fmtBytesMb,
  fmtCompact,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  labelOf,
  toneOf,
} from "@/lib/labels";
import { MOCK_TENANTS, type AdminTenant } from "@/lib/mock";
import {
  Badge,
  BarList,
  Button,
  Card,
  Field,
  Input,
  InfoBox,
  MockBadge,
  Modal,
  PageHeader,
  PendingEndpointNotice,
  Select,
  Table,
  Textarea,
  type Column,
} from "@/components/ui";

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
  const [createOpen, setCreateOpen] = useState(false);

  const res = useResource<AdminTenant[]>("/tenants", [...MOCK_TENANTS], {
    query: { search: search || undefined, plan: plan || undefined, status: status || undefined },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    return res.data.filter((t) => {
      if (plan && t.plan !== plan) return false;
      if (status && t.status !== status) return false;
      if (!q) return true;
      return (
        t.name.toLocaleLowerCase("tr").includes(q) ||
        t.city.toLocaleLowerCase("tr").includes(q) ||
        t.billingEmail.toLocaleLowerCase("tr").includes(q) ||
        t.code.toLocaleLowerCase("tr").includes(q)
      );
    });
  }, [res.data, search, plan, status]);

  const columns: Array<Column<AdminTenant>> = [
    {
      key: "name",
      header: "Büro",
      render: (t) => (
        <div>
          <Link href={`/tenantlar/${t.id}`} className="font-medium text-steel-50 hover:text-accent-300">
            {t.name}
          </Link>
          <p className="text-xs text-steel-500">
            {t.city} · {t.barAssociation} · #{t.code}
          </p>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan / Durum",
      render: (t) => (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={toneOf(PLAN_TONES, t.plan)}>{labelOf(PLAN_LABELS, t.plan)}</Badge>
          <Badge tone={toneOf(SUBSCRIPTION_STATUS_TONES, t.status)}>
            {labelOf(SUBSCRIPTION_STATUS_LABELS, t.status)}
          </Badge>
        </div>
      ),
    },
    { key: "users", header: "Kullanıcı", align: "right", render: (t) => fmtNumber(t.users) },
    { key: "cases", header: "Dosya", align: "right", render: (t) => fmtNumber(t.cases) },
    { key: "storage", header: "Depo", align: "right", render: (t) => fmtBytesMb(t.storageMb) },
    {
      key: "ai",
      header: "AI (30g)",
      align: "right",
      render: (t) => (
        <span className="font-mono text-steel-200">{fmtCompact(t.aiCalls30d)}</span>
      ),
    },
    {
      key: "provider",
      header: "Sağlayıcı",
      render: (t) => (
        <Badge tone={toneOf(AI_PROVIDER_TYPE_TONES, t.providerType)}>
          {labelOf(AI_PROVIDER_TYPE_LABELS, t.providerType)}
        </Badge>
      ),
    },
    { key: "mrr", header: "MRR", align: "right", render: (t) => fmtMoney(t.mrr) },
    {
      key: "balance",
      header: "Açık bakiye",
      align: "right",
      render: (t) =>
        t.openBalance > 0 ? (
          <span className="text-red-300">{fmtMoney(t.openBalance)}</span>
        ) : (
          <span className="text-steel-500">—</span>
        ),
    },
    {
      key: "last",
      header: "Son aktivite",
      render: (t) => <span className="text-xs text-steel-400">{fmtDateTime(t.lastActivityAt)}</span>,
    },
  ];

  if (masked) return <MaskedTenantView rows={res.data} pending={res.pending} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenantlar"
        description="Hukuk bürolarının platform kaydı. Panel yalnız sayaç ve metadata görür; müvekkil/dosya içeriğine erişim yoktur."
        action={
          <div className="flex items-center gap-2">
            {res.pending && <MockBadge />}
            <RoleGate action="tenant.create" mutation>
              <Button onClick={() => setCreateOpen(true)}>Yeni tenant</Button>
            </RoleGate>
          </div>
        }
      />

      {res.pending && <PendingEndpointNotice endpoint="/tenants" phase="Faz 1" />}

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Arama">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Büro adı, il, e-posta, kod"
            />
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
        title={`${rows.length} tenant`}
        subtitle="Satıra tıklayarak detay sekmelerine geçebilirsiniz."
      >
        <Table columns={columns} rows={rows} rowKey={(t) => t.id} dense />
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Manuel tenant açılışı"
        subtitle="POST /tenants — SUPER_ADMIN ve OPS_ADMIN"
      >
        <div className="space-y-4">
          <PendingEndpointNotice endpoint="/tenants" phase="Faz 1" method="POST" />
          <Field label="Büro adı" required>
            <Input placeholder="Örn. Yıldırım & Ortakları Hukuk Bürosu" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="İl" required>
              <Input placeholder="İstanbul" />
            </Field>
            <Field label="Baro">
              <Input placeholder="İstanbul Barosu" />
            </Field>
          </div>
          <Field label="Faturalama e-postası" required>
            <Input type="email" placeholder="finans@buro.example" />
          </Field>
          <Field label="Plan" required>
            <Select defaultValue="TRIAL">
              {PLAN_CODES.map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Gerekçe / not" hint="PlatformAuditLog'a yazılır." required>
            <Textarea rows={3} placeholder="Satış ekibinden gelen manuel onboarding talebi…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Vazgeç
            </Button>
            <Button disabled title="Uç henüz uygulanmadı">
              Oluştur
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 🔒 ANALYST_READONLY görünümü — büro adı, e-posta ve tekil sayaç yoktur. */
function MaskedTenantView({ rows, pending }: { rows: readonly AdminTenant[]; pending: boolean }) {
  const byPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of rows) map.set(t.plan, (map.get(t.plan) ?? 0) + 1);
    return [...map.entries()].map(([plan, count]) => ({ plan, count }));
  }, [rows]);

  const byStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of rows) map.set(t.status, (map.get(t.status) ?? 0) + 1);
    return [...map.entries()].map(([status, count]) => ({ status, count }));
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenant Dağılımı"
        description="Analist rolünde tenant listesi maskelidir: yalnız plan ve segment agregatı gösterilir."
        action={pending ? <MockBadge /> : undefined}
      />
      <InfoBox title="Maskeli görünüm (🔒)">
        Büro adı, e-posta, il/baro, müvekkil ve dosya verisi bu rolde <strong>hiçbir koşulda</strong>{" "}
        gösterilmez. Tenant kimliği gerektiğinde takma ad kullanılır.
      </InfoBox>
      {pending && <PendingEndpointNotice endpoint="/tenants" phase="Faz 1" />}
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
      <div className="text-xs text-steel-500">
        <ApprovalBadge action="tenant.suspend" force />{" "}
        <span className="ml-2">
          Yazma işlemleri bu rolde hiç render edilmez ve API katmanında 403 döner.
        </span>
      </div>
    </div>
  );
}
