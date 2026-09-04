"use client";

/**
 * Genel Bakış — platform KPI'ları, sistem sağlığı, bekleyen onaylar, son kritik olaylar.
 *
 * ANALYST_READONLY bu ekranı görmez; aynı yolda /metrics/investor verisiyle beslenen
 * YATIRIMCI GÖRÜNÜMÜ açılır (tenant adı, kullanıcı e-postası ve tekil kayıt YOKTUR).
 *
 * Uçlar: GET /metrics/overview · /health · /approvals?status=BEKLIYOR · /audit · /metrics/usage
 *        (analist) GET /metrics/investor
 */

import { useMemo } from "react";
import Link from "next/link";
import { useListResource, useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
import { EP } from "@/lib/endpoints";
import { can, isAnalyst } from "@/lib/rbac";
import { normalizeHealth } from "@/lib/health";
import {
  APPROVAL_ACTION_LABELS,
  AUDIT_ACTION_LABELS,
  CRITICAL_AUDIT_ACTIONS,
  HEALTH_STATUS_LABELS,
  HEALTH_STATUS_TONES,
  daysAgo,
  fmtCompact,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  labelOf,
  pseudoTenant,
  toDateInput,
  toneOf,
} from "@/lib/labels";
import type {
  AdminApprovalRequest,
  AdminAuditEntry,
  AdminHealthResponse,
  AdminInvestorMetrics,
  AdminOverview,
  AdminUsagePoint,
} from "@/lib/types";
import {
  Badge,
  BarList,
  Card,
  ColumnChart,
  DataRow,
  EmptyState,
  HealthDot,
  InfoBox,
  LineChart,
  PageHeader,
  ResourceView,
  StatCard,
  Table,
  type Column,
} from "@/components/ui";
import { ApprovalStatusBadge } from "@/components/ApprovalBadge";

export default function GenelBakisPage() {
  const { role, ready } = useAdminSession();
  if (!ready) return null;
  return isAnalyst(role) ? <InvestorView /> : <OverviewView />;
}

// =====================================================================
// Operasyon görünümü (SUPER_ADMIN / OPS_ADMIN / BILLING_ADMIN / SUPPORT_AGENT)
// =====================================================================

function OverviewView() {
  const { role } = useAdminSession();

  const overview = useResource<AdminOverview>(EP.metrics.overview);
  const health = useResource<AdminHealthResponse>(
    can(role, "system.health") ? EP.health : null,
  );
  const approvals = useListResource<AdminApprovalRequest>(
    can(role, "approval.view") ? EP.approvals.list : null,
    { query: { status: "BEKLIYOR" } },
  );
  const audit = useListResource<AdminAuditEntry>(
    can(role, "audit.view") ? EP.audit : null,
    { query: { limit: 10 } },
  );
  const usage = useListResource<AdminUsagePoint>(EP.metrics.usage, {
    query: { from: toDateInput(daysAgo(29)), to: toDateInput(new Date()) },
  });

  const o = overview.data;
  // /metrics/overview iç içe döner ({tenants, revenue, attention, ai}) —
  // kartlar bu gerçek şekilden okur; API'de olmayan metrik dürüstçe "—" kalır.
  const totalTenants = o?.tenants?.total ?? null;
  const activeTenants = o?.tenants?.active ?? null;
  const suspendedTenants = o?.tenants?.suspended ?? null;
  const trialTenants = o?.tenants?.trial ?? null;
  const newThisMonth = o?.tenants?.newThisMonth ?? null;
  const mrr = o?.revenue?.mrr ?? null;
  const arr = o?.revenue?.arr ?? null;
  const failedPayments = o?.attention?.failedPayments ?? null;
  const aiCallCount30d = o?.ai?.callCount ?? null;
  const aiInputTokens30d = o?.ai?.inputTokens ?? null;
  const aiOutputTokens30d = o?.ai?.outputTokens ?? null;
  const checks = useMemo(() => normalizeHealth(health.data), [health.data]);

  const aiSeries = useMemo(
    () =>
      usage.data
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((p) => ({
          label: new Date(p.date).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }),
          value: Number(p.aiCallCount ?? 0),
        })),
    [usage.data],
  );

  const criticalLogs = useMemo(
    () => audit.data.filter((l) => CRITICAL_AUDIT_ACTIONS.includes(l.action)).slice(0, 6),
    [audit.data],
  );

  const pending = approvals.data.filter((a) => a.status === "BEKLIYOR");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Genel Bakış"
        description="Platform sağlığı, tenant yaşam döngüsü ve AI hacminin tek ekranda özeti. Panel token sayar, fiyatlamaz."
      />

      <Card title="Platform göstergeleri" subtitle="Kaynak: GET /metrics/overview">
        <ResourceView
          loading={overview.loading}
          missing={overview.missing}
          forbidden={overview.forbidden}
          error={overview.error}
          endpoint={EP.metrics.overview}
          what="Platform KPI'ları"
          empty={overview.loaded && !o}
          emptyMessage="Gösterge verisi dönmedi."
        >
          {o && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Toplam tenant"
                value={fmtNumber(totalTenants)}
                trend={
                  newThisMonth !== null && newThisMonth !== undefined
                    ? `+${newThisMonth} bu ay`
                    : undefined
                }
                href="/tenantlar"
              />
              <StatCard
                label="Aktif tenant"
                value={fmtNumber(activeTenants)}
                hint={`${fmtNumber(suspendedTenants)} askıda · ${fmtNumber(trialTenants)} deneme`}
                tone="green"
              />
              <StatCard
                label="MRR"
                value={fmtMoney(mrr)}
                trend={arr ? `ARR ${fmtMoney(arr)}` : undefined}
                hint="KDV hariç"
                tone="accent"
              />
              <StatCard
                label="Aylık churn"
                value={fmtPercent(o?.churnPct)}
                hint={
                  o?.trialConversionPct !== null && o?.trialConversionPct !== undefined
                    ? `deneme→ücretli ${fmtPercent(o.trialConversionPct, 0)}`
                    : undefined
                }
                tone={(o?.churnPct ?? 0) > 2 ? "yellow" : "steel"}
              />
              <StatCard
                label="AI çağrısı (30g)"
                value={fmtCompact(aiCallCount30d)}
                hint="prompt/yanıt gövdesi hiçbir ekranda yoktur"
                href="/kullanim"
              />
              <StatCard
                label="Token (30g)"
                value={fmtCompact((aiInputTokens30d ?? 0) + (aiOutputTokens30d ?? 0))}
                hint={`girdi ${fmtCompact(aiInputTokens30d)} · çıktı ${fmtCompact(aiOutputTokens30d)}`}
              />
              <StatCard
                label="Başarısız ödeme"
                value={fmtNumber(failedPayments)}
                tone={(failedPayments ?? 0) > 0 ? "red" : "steel"}
                href="/odemeler"
              />
              <StatCard
                label="Bekleyen onaylar"
                value={fmtNumber(pending.length)}
                hint="dört-göz kuyruğu"
                tone={pending.length > 0 ? "yellow" : "steel"}
                href="/onaylar"
              />
            </div>
          )}
        </ResourceView>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="AI çağrı hacmi (30 gün)"
          subtitle="Kaynak: GET /metrics/usage — UsageSnapshot günlük toplamları"
        >
          <ResourceView
            loading={usage.loading}
            missing={usage.missing}
            forbidden={usage.forbidden}
            error={usage.error}
            empty={aiSeries.length === 0 && usage.loaded}
            endpoint={EP.metrics.usage}
            what="Günlük kullanım serisi"
            emptyMessage="Seçili aralıkta kullanım kaydı yok."
          >
            <ColumnChart points={aiSeries} ariaLabel="Son 30 günlük AI çağrı sayısı" />
          </ResourceView>
        </Card>

        <Card
          title="Sistem sağlığı"
          subtitle="Kaynak: GET /health — panel bir APM değildir, özet gösterir."
        >
          {!can(role, "system.health") ? (
            <InfoBox>Sistem sağlık panosu rolünüze kapalıdır.</InfoBox>
          ) : (
            <ResourceView
              loading={health.loading}
              missing={health.missing}
              forbidden={health.forbidden}
              error={health.error}
              empty={health.loaded && checks.length === 0}
              endpoint={EP.health}
              what="Sistem sağlığı"
              emptyMessage="Sağlık kontrolü satırı dönmedi."
            >
              <ul className="grid gap-3 sm:grid-cols-2">
                {checks.map((h) => (
                  <li
                    key={h.key}
                    className="rounded-lg border border-steel-800 bg-steel-950/60 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-steel-100">
                        <HealthDot status={h.status} />
                        {h.label}
                      </span>
                      <Badge tone={toneOf(HEALTH_STATUS_TONES, h.status)}>
                        {labelOf(HEALTH_STATUS_LABELS, h.status)}
                      </Badge>
                    </div>
                    {h.value && <p className="mt-1.5 font-mono text-sm text-steel-200">{h.value}</p>}
                    {h.detail && <p className="mt-0.5 text-xs text-steel-500">{h.detail}</p>}
                    {h.checkedAt && (
                      <p className="mt-1 text-[11px] text-steel-600">
                        Ölçüm: {fmtDateTime(h.checkedAt)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </ResourceView>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Bekleyen dört-göz onayları"
          subtitle="Talep eden ≠ onaylayan · 72 saatte zaman aşımı"
          action={
            can(role, "approval.view") ? (
              <Link href="/onaylar" className="text-xs text-accent-300 hover:text-accent-200">
                Kuyruğu aç →
              </Link>
            ) : undefined
          }
        >
          {!can(role, "approval.view") ? (
            <InfoBox>Onay kuyruğu rolünüze kapalıdır.</InfoBox>
          ) : (
            <ResourceView
              loading={approvals.loading}
              missing={approvals.missing}
              forbidden={approvals.forbidden}
              error={approvals.error}
              empty={pending.length === 0 && approvals.loaded}
              endpoint={EP.approvals.list}
              what="Onay kuyruğu"
              emptyMessage="Bekleyen onay yok."
            >
              <ul className="space-y-3">
                {pending.slice(0, 5).map((a) => (
                  <li key={a.id} className="rounded-lg border border-steel-800 bg-steel-950/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-steel-100">
                        {labelOf(APPROVAL_ACTION_LABELS, a.action)}
                        {a.tenantName ? ` — ${a.tenantName}` : ""}
                      </p>
                      <ApprovalStatusBadge status={a.status} expiresAt={a.expiresAt} />
                    </div>
                    <p className="mt-1 text-xs text-steel-500">
                      Talep: {a.requestedByEmail ?? a.requestedBy}
                      {a.requestedByRole ? ` (${a.requestedByRole})` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </ResourceView>
          )}
        </Card>

        <Card
          title="Son kritik yönetici işlemleri"
          subtitle="PlatformAuditLog — append-only"
          action={
            can(role, "audit.view") ? (
              <Link href="/denetim" className="text-xs text-accent-300 hover:text-accent-200">
                Tümünü gör →
              </Link>
            ) : undefined
          }
        >
          {!can(role, "audit.view") ? (
            <InfoBox>Denetim izi rolünüze kapalıdır.</InfoBox>
          ) : (
            <ResourceView
              loading={audit.loading}
              missing={audit.missing}
              forbidden={audit.forbidden}
              error={audit.error}
              empty={audit.loaded && audit.data.length === 0}
              endpoint={EP.audit}
              what="Denetim izi"
              emptyMessage="Denetim kaydı yok."
            >
              {criticalLogs.length === 0 ? (
                <EmptyState message="Son kayıtlar arasında kritik işlem yok." />
              ) : (
                <ul className="space-y-2.5">
                  {criticalLogs.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="text-steel-100">{labelOf(AUDIT_ACTION_LABELS, l.action)}</p>
                        <p className="text-xs text-steel-500">
                          {l.platformUserEmail ?? "—"} · {l.tenantName ?? "platform"}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-steel-500">
                        {fmtDateTime(l.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ResourceView>
          )}
        </Card>
      </div>
    </div>
  );
}

// =====================================================================
// Yatırımcı görünümü (ANALYST_READONLY — tek ekranı)
// =====================================================================

function InvestorView() {
  const res = useResource<AdminInvestorMetrics>(EP.metrics.investor);
  const m = res.data;

  const mrrSeries = useMemo(
    () => (m?.mrrSeries ?? []).map((r) => ({ label: r.month, value: Number(r.mrr ?? 0) })),
    [m],
  );

  const funnel = m?.activationFunnel ?? [];
  const plans = m?.planDistribution ?? [];

  const planColumns: Array<Column<{ planKey: string; count: number; mrr?: string | number | null }>> = [
    { key: "plan", header: "Plan", render: (r) => r.planKey },
    { key: "count", header: "Tenant", align: "right", render: (r) => fmtNumber(r.count) },
    { key: "mrr", header: "MRR", align: "right", render: (r) => fmtMoney(r.mrr) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Yatırımcı Görünümü"
        description="Toplulaştırılmış yatırımcı/ortak veri seti. Tenant kimliği, kullanıcı e-postası, müvekkil/dosya verisi ve tekil ödeme detayı bu görünümde bulunmaz."
      />

      <InfoBox title="Bu görünümün sözleşmesi">
        Yanıt kolon bazlı <strong>allowlist</strong> ile sınırlıdır; tenant kimliği taşıyan alan bu
        kümeye eklenemez. Rolün <strong>hiçbir yazma yetkisi yoktur</strong>: tüm mutasyon uçları bu
        rol için 403 döner ve panelde ilgili düğmeler hiç render edilmez. Tenant gösterimi
        gerektiğinde oturum kapsamlı takma ad kullanılır (ör.{" "}
        <span className="font-mono">{pseudoTenant("ornek")}</span>) — bu bir anonimleştirme değil,
        takma adlandırmadır.
      </InfoBox>

      <ResourceView
        loading={res.loading}
        missing={res.missing}
        forbidden={res.forbidden}
        error={res.error}
        empty={res.loaded && !m}
        endpoint={EP.metrics.investor}
        what="Yatırımcı metrikleri"
        emptyMessage="Yatırımcı veri seti dönmedi."
      >
        {m && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="MRR" value={fmtMoney(m.mrr)} tone="accent" />
              <StatCard label="ARR" value={fmtMoney(m.arr)} />
              <StatCard
                label="Ödeyen tenant"
                value={fmtNumber(m.payingTenants)}
                trend={
                  m.newTenantsThisMonth !== null && m.newTenantsThisMonth !== undefined
                    ? `+${m.newTenantsThisMonth} yeni`
                    : undefined
                }
              />
              <StatCard label="Aylık churn" value={fmtPercent(m.churnPct)} />
              <StatCard label="NRR" value={fmtPercent(m.nrrPct)} hint="net gelir tutundurma" />
              <StatCard
                label="DAU / WAU"
                value={`${fmtNumber(m.dau)} / ${fmtNumber(m.wau)}`}
                hint={`MAU ${fmtNumber(m.mau)}`}
              />
              <StatCard
                label="AI çağrısı (30g)"
                value={fmtCompact(m.aiCallCount30d)}
                hint="panel token sayar, fiyatlamaz"
              />
              <StatCard label="Uptime" value={fmtPercent(m.uptimePct, 2)} />
            </div>

            <Card title="MRR gelişimi" subtitle="Aylık — tenant adı içermez">
              {mrrSeries.length === 0 ? (
                <EmptyState message="MRR serisi dönmedi." />
              ) : (
                <LineChart
                  points={mrrSeries}
                  ariaLabel="Aylık MRR gelişimi"
                  valueFormatter={(v) => fmtMoney(v)}
                />
              )}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card
                title="Aktivasyon hunisi"
                subtitle="Tenant kimliği taşımaz; yalnız adım sayıları."
              >
                {funnel.length === 0 ? (
                  <EmptyState message="Huni verisi dönmedi." />
                ) : (
                  <BarList
                    items={funnel.map((f) => ({
                      label: f.label ?? f.step,
                      value: f.count,
                      hint: fmtNumber(f.count),
                    }))}
                  />
                )}
              </Card>

              <Card title="Plan dağılımı" subtitle="Segment seviyesinde — tekil büro gösterilmez.">
                {plans.length === 0 ? (
                  <EmptyState message="Plan dağılımı dönmedi." />
                ) : (
                  <>
                    <BarList
                      items={plans.map((p) => ({
                        label: p.planKey,
                        value: p.count,
                        hint: `${p.count} tenant`,
                        tone: "green" as const,
                      }))}
                    />
                    <div className="mt-4">
                      <Table
                        columns={planColumns}
                        rows={plans}
                        rowKey={(r) => r.planKey}
                        dense
                      />
                    </div>
                  </>
                )}
              </Card>
            </div>

            <Card title="Ölçüm notu">
              <DataRow label="Token maliyeti">
                Panel token <strong>sayar</strong>, fiyatlamaz — BYO-LLM&apos;de maliyet büronun
                kendi sağlayıcı hesabındadır.
              </DataRow>
              <DataRow label="Toplam token (30g)">{fmtCompact(m.aiTokens30d)}</DataRow>
              <DataRow label="Toplam tenant">{fmtNumber(m.totalTenants)}</DataRow>
            </Card>
          </div>
        )}
      </ResourceView>
    </div>
  );
}
