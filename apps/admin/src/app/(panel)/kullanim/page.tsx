"use client";

/**
 * AI / token analitiği — tenant × görev tipi × sağlayıcı × model kırılımı.
 * İlke: PANEL TOKEN SAYAR, FİYATLAMAZ. BYO-LLM gereği token maliyeti büronun kendi
 * sağlayıcı hesabındadır; bu ekranda "AI maliyeti (TL)" kolonu YOKTUR.
 * Görselleştirme harici kütüphane olmadan saf CSS/SVG ile çizilir.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
import { can, isMasked } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import {
  AI_PROVIDER_TYPE_LABELS,
  AI_TASK_TYPE_LABELS,
  pseudoTenant,
  fmtCompact,
  fmtNumber,
  fmtPercent,
  labelOf,
} from "@/lib/labels";
import { MOCK_AI_DAILY, MOCK_USAGE, type AdminUsageRow } from "@/lib/mock";
import {
  Badge,
  BarList,
  Button,
  Card,
  ColumnChart,
  Field,
  InfoBox,
  MockBadge,
  PageHeader,
  PendingEndpointNotice,
  Select,
  StatCard,
  Table,
  WarningBox,
  type Column,
} from "@/components/ui";

export default function KullanimPage() {
  return (
    <PageGate action="ai.analytics.platform">
      <UsageAnalytics />
    </PageGate>
  );
}

function UsageAnalytics() {
  const { role } = useAdminSession();
  const anonymous = isMasked(role, "ai.analytics.platform");
  const canSeeTenant = can(role, "ai.analytics.tenant");

  const [taskType, setTaskType] = useState("");
  const [provider, setProvider] = useState("");
  const [tenant, setTenant] = useState("");

  const res = useResource<AdminUsageRow[]>("/metrics/ai", [...MOCK_USAGE], {
    query: {
      taskType: taskType || undefined,
      providerType: provider || undefined,
      tenantId: tenant || undefined,
    },
  });

  const rows = useMemo(
    () =>
      res.data.filter((r) => {
        if (taskType && r.taskType !== taskType) return false;
        if (provider && r.providerType !== provider) return false;
        if (tenant && r.tenantId !== tenant) return false;
        return true;
      }),
    [res.data, taskType, provider, tenant],
  );

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        calls: acc.calls + r.calls,
        input: acc.input + r.inputTokens,
        output: acc.output + r.outputTokens,
        noToken: acc.noToken + r.noTokenInfoCalls,
        errWeighted: acc.errWeighted + (r.errorRatePct * r.calls) / 100,
        piiWeighted: acc.piiWeighted + (r.piiMaskedPct * r.calls) / 100,
      }),
      { calls: 0, input: 0, output: 0, noToken: 0, errWeighted: 0, piiWeighted: 0 },
    );
  }, [rows]);

  const byProvider = useMemo(() => aggregate(rows, (r) => r.providerType), [rows]);
  const byTask = useMemo(() => aggregate(rows, (r) => r.taskType), [rows]);
  const byModel = useMemo(() => aggregate(rows, (r) => r.model), [rows]);
  const byTenant = useMemo(() => aggregate(rows, (r) => r.tenantCode), [rows]);

  const taskOptions = useMemo(() => unique(res.data.map((r) => r.taskType)), [res.data]);
  const providerOptions = useMemo(() => unique(res.data.map((r) => r.providerType)), [res.data]);
  const tenantOptions = useMemo(
    () =>
      unique(res.data.map((r) => r.tenantId)).map((id) => {
        const row = res.data.find((r) => r.tenantId === id);
        return { id, label: row ? (anonymous ? pseudoTenant(row.tenantCode) : row.tenantName) : id };
      }),
    [res.data, anonymous],
  );

  const columns: Array<Column<AdminUsageRow>> = [
    ...(canSeeTenant || anonymous
      ? [
          {
            key: "tenant",
            header: "Tenant",
            render: (r: AdminUsageRow) =>
              anonymous ? (
                <span className="font-mono text-xs text-steel-300">{pseudoTenant(r.tenantCode)}</span>
              ) : (
                <Link href={`/tenantlar/${r.tenantId}`} className="text-steel-100 hover:text-accent-300">
                  {r.tenantName}
                </Link>
              ),
          } satisfies Column<AdminUsageRow>,
        ]
      : []),
    {
      key: "task",
      header: "Görev tipi",
      render: (r) => (
        <div>
          <p className="font-mono text-xs text-steel-200">{r.taskType}</p>
          <p className="text-xs text-steel-500">{labelOf(AI_TASK_TYPE_LABELS, r.taskType)}</p>
        </div>
      ),
    },
    {
      key: "provider",
      header: "Sağlayıcı",
      render: (r) => <Badge tone="steel">{labelOf(AI_PROVIDER_TYPE_LABELS, r.providerType)}</Badge>,
    },
    { key: "model", header: "Model", render: (r) => <span className="font-mono text-xs">{r.model}</span> },
    { key: "calls", header: "Çağrı", align: "right", render: (r) => fmtNumber(r.calls) },
    {
      key: "in",
      header: "Girdi token",
      align: "right",
      render: (r) =>
        r.inputTokens === 0 && r.noTokenInfoCalls > 0 ? (
          <span className="text-steel-500">yok</span>
        ) : (
          <span className="font-mono">{fmtCompact(r.inputTokens)}</span>
        ),
    },
    {
      key: "out",
      header: "Çıktı token",
      align: "right",
      render: (r) =>
        r.outputTokens === 0 && r.noTokenInfoCalls > 0 ? (
          <span className="text-steel-500">yok</span>
        ) : (
          <span className="font-mono">{fmtCompact(r.outputTokens)}</span>
        ),
    },
    {
      key: "notoken",
      header: "Token bilgisi yok",
      align: "right",
      render: (r) =>
        r.noTokenInfoCalls > 0 ? (
          <Badge tone="yellow">{fmtNumber(r.noTokenInfoCalls)}</Badge>
        ) : (
          <span className="text-steel-600">—</span>
        ),
    },
    {
      key: "err",
      header: "Hata",
      align: "right",
      render: (r) => (
        <span className={r.errorRatePct > 20 ? "text-red-300" : ""}>{fmtPercent(r.errorRatePct)}</span>
      ),
    },
    { key: "pii", header: "PII maskeli", align: "right", render: (r) => fmtPercent(r.piiMaskedPct) },
    { key: "p95", header: "p95", align: "right", render: (r) => `${fmtNumber(r.p95Ms)} ms` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Kullanımı"
        description="Kaynak: AiUsageLog'un yalnız metrik kolonları. Prompt ve yanıt gövdesi hiçbir ekranda, hiçbir sorguda yer almaz."
        action={res.pending ? <MockBadge /> : undefined}
      />

      {res.pending && <PendingEndpointNotice endpoint="/metrics/ai" phase="Faz 2" />}

      <WarningBox title="Panel token sayar, fiyatlamaz">
        BYO-LLM gereği token maliyeti büronun kendi sağlayıcı hesabındadır; bu ekranda{" "}
        <strong>&quot;AI maliyeti (TL)&quot; kolonu yoktur</strong>. OLLAMA/CUSTOM çağrılarında
        sağlayıcı token bilgisi dönmeyebilir — bu kayıtlar &quot;token bilgisi yok&quot; olarak{" "}
        <strong>ayrı sayılır, sıfır varsayılmaz</strong>.
      </WarningBox>

      {anonymous && (
        <InfoBox title="Takma adlı görünüm (🔒)">
          Analist rolünde tenant kimliği gösterilmez; büro adları <strong>takma adla</strong> yer alır
          ve tenant detay kırılımı kapalıdır. Takma adlar oturum kapsamlıdır ve gerçek tenant
          kodundan türetilmez; bu bir <strong>anonimleştirme değil, takma adlandırmadır</strong>
          (KVKK m.28 anlamında anonim veri sayılmaz). Kurul Raporu veri setinde takma ad sunucuda,
          rapor kapsamında üretilir ve yanıt tenant kimliği taşıyan kolon içermez.
        </InfoBox>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Toplam çağrı" value={fmtCompact(totals.calls)} hint="filtrelenmiş küme" />
        <StatCard label="Girdi token" value={fmtCompact(totals.input)} />
        <StatCard label="Çıktı token" value={fmtCompact(totals.output)} />
        <StatCard
          label="Token bilgisi yok"
          value={fmtCompact(totals.noToken)}
          tone={totals.noToken > 0 ? "yellow" : "steel"}
          hint="sıfır varsayılmaz"
        />
        <StatCard
          label="Ort. hata oranı"
          value={fmtPercent(totals.calls ? (totals.errWeighted / totals.calls) * 100 : 0)}
          tone="steel"
          hint={`PII maskeli %${
            totals.calls ? Math.round((totals.piiWeighted / totals.calls) * 100) : 0
          }`}
        />
      </div>

      <Card title="Günlük çağrı hacmi (30 gün)">
        <ColumnChart points={MOCK_AI_DAILY} ariaLabel="Günlük AI çağrı sayısı" />
      </Card>

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Görev tipi">
            <Select value={taskType} onChange={(e) => setTaskType(e.target.value)}>
              <option value="">Tümü</option>
              {taskOptions.map((t) => (
                <option key={t} value={t}>
                  {t} — {labelOf(AI_TASK_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sağlayıcı tipi">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">Tümü</option>
              {providerOptions.map((p) => (
                <option key={p} value={p}>
                  {labelOf(AI_PROVIDER_TYPE_LABELS, p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tenant">
            <Select
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              disabled={!canSeeTenant && !anonymous}
            >
              <option value="">Tümü</option>
              {tenantOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                setTaskType("");
                setProvider("");
                setTenant("");
              }}
            >
              Filtreleri temizle
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Sağlayıcı tipine göre çağrı">
          <BarList
            items={byProvider.map((x) => ({
              label: labelOf(AI_PROVIDER_TYPE_LABELS, x.key),
              value: x.calls,
              hint: fmtCompact(x.calls),
            }))}
          />
        </Card>
        <Card title="Görev tipine göre çağrı">
          <BarList
            items={byTask.slice(0, 8).map((x) => ({
              label: labelOf(AI_TASK_TYPE_LABELS, x.key),
              value: x.calls,
              hint: fmtCompact(x.calls),
              tone: "green" as const,
            }))}
          />
        </Card>
        <Card title="Modele göre token">
          <BarList
            items={byModel.slice(0, 8).map((x) => ({
              label: x.key,
              value: x.tokens,
              hint: x.tokens === 0 ? "token bilgisi yok" : fmtCompact(x.tokens),
              tone: x.tokens === 0 ? ("yellow" as const) : ("accent" as const),
            }))}
          />
        </Card>
      </div>

      <Card
        title="En çok tüketen tenantlar"
        subtitle={
          anonymous
            ? "Takma adla — tenant kimliği gösterilmez (anonim değil, takma adlı)."
            : "Çağrı sayısına göre ilk 10."
        }
      >
        <BarList
          items={byTenant.slice(0, 10).map((x) => ({
            label: anonymous ? pseudoTenant(x.key) : tenantNameByCode(res.data, x.key),
            value: x.calls,
            hint: fmtCompact(x.calls),
          }))}
        />
      </Card>

      <Card
        title={`Pivot — ${rows.length} satır`}
        subtitle="tenant × görev tipi × sağlayıcı × model"
      >
        <Table columns={columns} rows={rows} rowKey={(r, i) => `${r.tenantId}-${r.taskType}-${r.model}-${i}`} dense />
      </Card>
    </div>
  );
}

// ---------- yardımcılar ----------

interface Agg {
  key: string;
  calls: number;
  tokens: number;
}

function aggregate(rows: readonly AdminUsageRow[], keyOf: (r: AdminUsageRow) => string): Agg[] {
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const key = keyOf(r);
    const cur = map.get(key) ?? { key, calls: 0, tokens: 0 };
    cur.calls += r.calls;
    cur.tokens += r.inputTokens + r.outputTokens;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.calls - a.calls);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function tenantNameByCode(rows: readonly AdminUsageRow[], code: string): string {
  return rows.find((r) => r.tenantCode === code)?.tenantName ?? code;
}
