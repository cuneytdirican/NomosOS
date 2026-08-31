"use client";

/**
 * AI / token analitiği — GET /metrics/ai?groupBy= ve GET /metrics/usage?from=&to=
 *
 * İLKE: PANEL TOKEN SAYAR, FİYATLAMAZ. BYO-LLM gereği token maliyeti büronun kendi
 * sağlayıcı hesabındadır; bu ekranda "AI maliyeti (TL)" kolonu YOKTUR.
 * Görselleştirme harici kütüphane olmadan saf CSS/SVG ile çizilir.
 *
 * Kaynak yalnız AiUsageLog'un METRİK kolonlarıdır; prompt ve yanıt gövdesi hiçbir
 * ekranda, hiçbir sorguda yer almaz.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useListResource, useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
import { EP } from "@/lib/endpoints";
import { can, isMasked } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import {
  AI_GROUP_BY_OPTIONS,
  AI_PROVIDER_TYPE_LABELS,
  AI_TASK_TYPE_LABELS,
  daysAgo,
  fmtCompact,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  labelOf,
  pseudoTenant,
  toDateInput,
  type AiGroupBy,
} from "@/lib/labels";
import { exportCsv } from "@/lib/csv";
import type { AdminAiMetricRow, AdminMarginReport, AdminUsagePoint } from "@/lib/types";
import {
  Badge,
  BarList,
  Button,
  Card,
  ColumnChart,
  Field,
  InfoBox,
  Input,
  LineChart,
  PageHeader,
  ResourceView,
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

  const [groupBy, setGroupBy] = useState<AiGroupBy>("taskType");
  const [from, setFrom] = useState(toDateInput(daysAgo(29)));
  const [to, setTo] = useState(toDateInput(new Date()));

  const ai = useListResource<AdminAiMetricRow>(EP.metrics.ai, {
    query: { groupBy, from, to },
  });
  const usage = useListResource<AdminUsagePoint>(EP.metrics.usage, {
    query: { from, to },
  });

  /**
   * MODÜL 26 — maliyet / gelir / marj.
   *
   * Yönetilen AI modunda AI maliyeti NOMOSOS'undur; "panel token sayar,
   * fiyatlamaz" ilkesi yalnızca BYO-LLM büroları için geçerlidir. Rapora
   * yetkisi olmayan rol için istek HİÇ atılmaz (403 gürültüsü olmasın).
   */
  const canSeeMargin = can(role, "credits.margin.view");
  const margin = useResource<AdminMarginReport>(canSeeMargin ? EP.credits.margin : null, {
    query: { from, to },
  });
  /** tenantId → marj satırı. Maskeli görünümde kimlik yok, eşleme kurulamaz. */
  const marginByTenant = useMemo(() => {
    const map = new Map<string, AdminMarginReport["items"][number]>();
    for (const r of margin.data?.items ?? []) {
      if (r.tenantId) map.set(r.tenantId, r);
    }
    return map;
  }, [margin.data]);

  /** Gruplama anahtarına göre satır etiketi. Tenant kırılımında maskeleme uygulanır. */
  const rowLabel = useMemo(
    () =>
      (r: AdminAiMetricRow): string => {
        if (groupBy === "tenant") {
          const id = r.tenantId ?? r.key ?? "";
          if (anonymous || !canSeeTenant) return pseudoTenant(String(id));
          // `String(id) ?? "—"` ÖLÜ KODDU: `String()` asla null/undefined
          // dönmez, dolayısıyla adı da kimliği de olmayan satır boş etiketle
          // çiziliyordu (lint bulgusu, D ajanı). Boşluk açıkça sınanır.
          return r.tenantName ?? (id ? String(id) : "—");
        }
        if (groupBy === "taskType") {
          const t = r.taskType ?? r.key ?? "";
          return t ? labelOf(AI_TASK_TYPE_LABELS, t) : "—";
        }
        if (groupBy === "provider") {
          const p = r.providerType ?? r.key ?? "";
          return p ? labelOf(AI_PROVIDER_TYPE_LABELS, p) : "—";
        }
        return r.model ?? r.key ?? "—";
      },
    [groupBy, anonymous, canSeeTenant],
  );

  const rowRawKey = (r: AdminAiMetricRow, i: number): string =>
    String(r.key ?? r.tenantId ?? r.taskType ?? r.providerType ?? r.model ?? i);

  const totals = useMemo(() => {
    const acc = { calls: 0, input: 0, output: 0, unknown: 0, errors: 0 };
    for (const r of ai.data) {
      acc.calls += r.calls ?? 0;
      acc.input += r.inputTokens ?? 0;
      acc.output += r.outputTokens ?? 0;
      acc.unknown += r.unknownTokenCalls ?? 0;
      acc.errors += r.errorCount ?? 0;
    }
    return acc;
  }, [ai.data]);

  const series = useMemo(
    () =>
      usage.data
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((p) => ({
          label: new Date(p.date).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }),
          calls: Number(p.aiCallCount ?? 0),
          tokens: Number(p.aiInputTokens ?? 0) + Number(p.aiOutputTokens ?? 0),
        })),
    [usage.data],
  );

  const columns: Array<Column<AdminAiMetricRow>> = [
    {
      key: "label",
      header: AI_GROUP_BY_OPTIONS.find((o) => o.key === groupBy)?.label ?? "Kırılım",
      render: (r) =>
        groupBy === "tenant" && !anonymous && canSeeTenant && r.tenantId ? (
          <Link href={`/tenantlar/${r.tenantId}`} className="text-steel-100 hover:text-accent-300">
            {rowLabel(r)}
          </Link>
        ) : (
          <span className="text-steel-100">{rowLabel(r)}</span>
        ),
    },
    ...(groupBy === "taskType"
      ? [
          {
            key: "raw",
            header: "Enum",
            render: (r: AdminAiMetricRow) => (
              <span className="font-mono text-xs text-steel-500">{r.taskType ?? r.key ?? "—"}</span>
            ),
          } satisfies Column<AdminAiMetricRow>,
        ]
      : []),
    ...(groupBy === "model"
      ? [
          {
            key: "provider",
            header: "Sağlayıcı",
            render: (r: AdminAiMetricRow) =>
              r.providerType ? (
                <Badge tone="steel">{labelOf(AI_PROVIDER_TYPE_LABELS, r.providerType)}</Badge>
              ) : (
                "—"
              ),
          } satisfies Column<AdminAiMetricRow>,
        ]
      : []),
    { key: "calls", header: "Çağrı", align: "right", render: (r) => fmtNumber(r.calls) },
    {
      key: "in",
      header: "Girdi token",
      align: "right",
      render: (r) =>
        r.inputTokens === null || r.inputTokens === undefined ? (
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
        r.outputTokens === null || r.outputTokens === undefined ? (
          <span className="text-steel-500">yok</span>
        ) : (
          <span className="font-mono">{fmtCompact(r.outputTokens)}</span>
        ),
    },
    {
      key: "unknown",
      header: "Token bilgisi yok",
      align: "right",
      render: (r) =>
        r.unknownTokenCalls ? (
          <Badge tone="yellow">{fmtNumber(r.unknownTokenCalls)}</Badge>
        ) : (
          <span className="text-steel-600">—</span>
        ),
    },
    {
      key: "err",
      header: "Hata",
      align: "right",
      render: (r) => (
        <span className={(r.errorRatePct ?? 0) > 20 ? "text-red-300" : ""}>
          {fmtPercent(r.errorRatePct)}
        </span>
      ),
    },
    { key: "pii", header: "PII maskeli", align: "right", render: (r) => fmtPercent(r.piiMaskedPct) },
    {
      key: "p95",
      header: "p95",
      align: "right",
      render: (r) => (r.p95Ms === null || r.p95Ms === undefined ? "—" : `${fmtNumber(r.p95Ms)} ms`),
    },
    // --- Modül 26: maliyet / gelir / marj (yalnız tenant kırılımında) ---
    ...(groupBy === "tenant" && canSeeMargin
      ? ([
          {
            key: "cost",
            header: "Maliyet (USD)",
            align: "right",
            render: (r: AdminAiMetricRow) => {
              const m = r.tenantId ? marginByTenant.get(r.tenantId) : undefined;
              return m ? (
                <span className="font-mono">{fmtMoney(m.maliyetUsd, "USD")}</span>
              ) : (
                <span className="text-steel-600">—</span>
              );
            },
          },
          {
            key: "revenue",
            header: "Gelir (TL)",
            align: "right",
            render: (r: AdminAiMetricRow) => {
              const m = r.tenantId ? marginByTenant.get(r.tenantId) : undefined;
              if (!m) return <span className="text-steel-600">—</span>;
              if (m.mod !== "YONETILEN") return <Badge tone="green">BYO-LLM</Badge>;
              return m.gelirTl ? fmtMoney(m.gelirTl, "TRY") : <span className="text-steel-600">—</span>;
            },
          },
          {
            key: "margin",
            header: "Marj",
            align: "right",
            render: (r: AdminAiMetricRow) => {
              const m = r.tenantId ? marginByTenant.get(r.tenantId) : undefined;
              if (!m || m.marjTl === null) return <span className="text-steel-600">—</span>;
              return (
                <span className={Number(m.marjTl) < 0 ? "text-red-300" : "text-green-300"}>
                  {fmtMoney(m.marjTl, "TRY")}
                </span>
              );
            },
          },
        ] as Array<Column<AdminAiMetricRow>>)
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Kullanımı"
        description="Kaynak: AiUsageLog'un yalnız metrik kolonları. Prompt ve yanıt gövdesi hiçbir ekranda, hiçbir sorguda yer almaz."
        action={
          <Button
            variant="secondary"
            disabled={ai.data.length === 0}
            onClick={() =>
              exportCsv(`ai-kullanim-${groupBy}`, ai.data, [
                { key: "label", header: "Kırılım", value: (r) => rowLabel(r) },
                ...(anonymous || !canSeeTenant
                  ? []
                  : [
                      {
                        key: "tenantId",
                        header: "Tenant ID",
                        value: (r: AdminAiMetricRow) => r.tenantId ?? "",
                      },
                    ]),
                { key: "taskType", header: "Görev tipi", value: (r) => r.taskType ?? "" },
                { key: "provider", header: "Sağlayıcı", value: (r) => r.providerType ?? "" },
                { key: "model", header: "Model", value: (r) => r.model ?? "" },
                { key: "calls", header: "Çağrı", value: (r) => r.calls ?? "" },
                {
                  key: "in",
                  header: "Girdi token",
                  value: (r) => (r.inputTokens === null || r.inputTokens === undefined ? "" : r.inputTokens),
                },
                {
                  key: "out",
                  header: "Çıktı token",
                  value: (r) =>
                    r.outputTokens === null || r.outputTokens === undefined ? "" : r.outputTokens,
                },
                {
                  key: "unknown",
                  header: "Token bilgisi yok (çağrı)",
                  value: (r) => r.unknownTokenCalls ?? "",
                },
                { key: "err", header: "Hata oranı %", value: (r) => r.errorRatePct ?? "" },
                { key: "pii", header: "PII maskeli %", value: (r) => r.piiMaskedPct ?? "" },
                { key: "p95", header: "p95 (ms)", value: (r) => r.p95Ms ?? "" },
              ])
            }
          >
            CSV dışa aktar
          </Button>
        }
      />

      <WarningBox title="Maliyet YALNIZCA yönetilen AI modunda NomosOS'undur">
        <strong>BYO-LLM</strong> bürolarında maliyet kendi sağlayıcı hesaplarındadır ve o
        satırlarda marj hesaplanmaz — Modül 25&apos;in &quot;panel token sayar, fiyatlamaz&quot;
        ilkesi yalnızca onlar için geçerlidir. <strong>Yönetilen AI</strong> modunda her çağrı
        NomosOS&apos;un gideridir; maliyet/gelir/marj kolonları tenant kırılımında görünür ve{" "}
        <strong>iç muhasebedir, kullanıcıya gösterilmez</strong>. OLLAMA/CUSTOM çağrılarında
        sağlayıcı token bilgisi dönmeyebilir — bu kayıtlar &quot;token bilgisi yok&quot; olarak{" "}
        <strong>ayrı sayılır, sıfır varsayılmaz</strong> ve maliyetleri fiyatlanamaz.
      </WarningBox>

      {canSeeMargin && (
        <InfoBox title="Kredi ve fiyat yönetimi">
          Kredi cüzdanları, manuel tahsis (dört-göz), kredi fiyat listesi ve model maliyet tablosu{" "}
          <Link href="/krediler" className="text-accent-300 underline">
            Kredi &amp; Fiyatlar
          </Link>{" "}
          ekranındadır.
          {margin.data && !margin.data.marjHesaplanabilir && margin.data.marjUyarisi
            ? ` ${margin.data.marjUyarisi}`
            : ""}
        </InfoBox>
      )}

      {anonymous && (
        <InfoBox title="Takma adlı görünüm (🔒)">
          Bu rolde tenant kimliği gösterilmez; kırılımlar <strong>takma adla</strong> yer alır ve
          tenant detayına geçiş kapalıdır. Takma adlar oturum kapsamlıdır ve gerçek kimlikten
          türetilmez; bu bir <strong>anonimleştirme değil, takma adlandırmadır</strong>.
        </InfoBox>
      )}

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Kırılım" hint="Sunucuya ?groupBy= olarak gönderilir.">
            <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as AiGroupBy)}>
              {AI_GROUP_BY_OPTIONS.filter(
                (o) => o.key !== "tenant" || canSeeTenant || anonymous,
              ).map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlangıç">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                setFrom(toDateInput(daysAgo(29)));
                setTo(toDateInput(new Date()));
                setGroupBy("taskType");
              }}
            >
              Varsayılana dön
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Toplam çağrı" value={ai.loaded ? fmtCompact(totals.calls) : "—"} hint="seçili aralık" />
        <StatCard label="Girdi token" value={ai.loaded ? fmtCompact(totals.input) : "—"} />
        <StatCard label="Çıktı token" value={ai.loaded ? fmtCompact(totals.output) : "—"} />
        <StatCard
          label="Token bilgisi yok"
          value={ai.loaded ? fmtCompact(totals.unknown) : "—"}
          tone={totals.unknown > 0 ? "yellow" : "steel"}
          hint="sıfır varsayılmaz"
        />
        <StatCard
          label="Hatalı çağrı"
          value={ai.loaded ? fmtCompact(totals.errors) : "—"}
          tone={totals.errors > 0 ? "yellow" : "steel"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Günlük çağrı hacmi" subtitle="Kaynak: GET /metrics/usage">
          <ResourceView
            loading={usage.loading}
            missing={usage.missing}
            forbidden={usage.forbidden}
            error={usage.error}
            empty={usage.loaded && series.length === 0}
            endpoint={EP.metrics.usage}
            what="Günlük kullanım serisi"
            emptyMessage="Seçili aralıkta kullanım kaydı yok."
          >
            <ColumnChart
              points={series.map((s) => ({ label: s.label, value: s.calls }))}
              ariaLabel="Günlük AI çağrı sayısı"
            />
          </ResourceView>
        </Card>

        <Card title="Günlük token (girdi + çıktı)" subtitle="Token bilgisi dönmeyen çağrılar bu seriye girmez.">
          <ResourceView
            loading={usage.loading}
            missing={usage.missing}
            forbidden={usage.forbidden}
            error={usage.error}
            empty={usage.loaded && series.length === 0}
            endpoint={EP.metrics.usage}
            what="Günlük token serisi"
            emptyMessage="Seçili aralıkta token kaydı yok."
          >
            <LineChart
              points={series.map((s) => ({ label: s.label, value: s.tokens }))}
              ariaLabel="Günlük token tüketimi"
              valueFormatter={(v) => fmtCompact(v)}
            />
          </ResourceView>
        </Card>
      </div>

      <Card
        title={`Kırılım — ${AI_GROUP_BY_OPTIONS.find((o) => o.key === groupBy)?.label}`}
        subtitle="Çağrı sayısına göre"
      >
        <ResourceView
          loading={ai.loading}
          missing={ai.missing}
          forbidden={ai.forbidden}
          error={ai.error}
          empty={ai.empty}
          endpoint={EP.metrics.ai}
          what="AI kırılımı"
          emptyMessage="Seçili aralıkta AI kullanımı yok."
        >
          <div className="space-y-6">
            <BarList
              items={ai.data
                .slice()
                .sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0))
                .slice(0, 10)
                .map((r, i) => ({
                  label: `${rowLabel(r)}`,
                  value: r.calls ?? 0,
                  hint: fmtCompact(r.calls),
                  tone: (i === 0 ? "accent" : "steel") as "accent" | "steel",
                }))}
            />
            <Table columns={columns} rows={ai.data} rowKey={rowRawKey} dense />
          </div>
        </ResourceView>
      </Card>
    </div>
  );
}
