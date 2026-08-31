"use client";

/**
 * Rapor özeti — KPI şeridi ve basit görselleştirme.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ARTIŞ HER ZAMAN YEŞİL DEĞİLDİR.                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Her ölçünün bir "iyi yönü" vardır (`metricDirection`). Kaçırılan sürenin
 * artması yükselen bir oktur ama KIRMIZIDIR; tahsilatın artması yükselen bir
 * oktur ve YEŞİLDİR. Yön bilinmiyorsa renk verilmez — bilinmeyeni yeşile
 * boyamak, olmayan bir başarıyı raporlamak olurdu.
 *
 * Grafikler harici kütüphanesiz çizilir (ürün kararı): çubuklar saf CSS,
 * çizgiler satır içi SVG. Bu yüzden yazdırma çıktısında da aynı görünürler.
 */

import { BarList, Card, DeltaIndicator, LineChart } from "@/components/ui";
import { DELTA_TONE_CLASSES, METRIC_DIRECTION_LABELS, deltaTone, fmtDeltaPercent } from "@/lib/labels";
import { formatDelta, formatValue } from "../../_lib/faz6-format";
import type { ReportMetric, ReportSeries } from "../../_lib/faz6-types";

export function MetricStrip({ metrics }: { metrics: ReportMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((m) => (
        <MetricCard key={m.key} metric={m} />
      ))}
    </div>
  );
}

function MetricCard({ metric }: { metric: ReportMetric }) {
  const tone = deltaTone(metric.delta, metric.direction);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm print:shadow-none">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{metric.label}</p>
      <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-slate-900">
        {formatValue(metric.value, metric.type, metric.currency)}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <DeltaIndicator
          delta={metric.delta}
          tone={tone}
          valueText={formatDelta(metric.delta, metric.type, metric.currency)}
          percentText={
            metric.deltaPercent === null ? undefined : fmtDeltaPercent(metric.deltaPercent)
          }
          previousText={
            metric.previous === null
              ? undefined
              : formatValue(metric.previous, metric.type, metric.currency)
          }
        />
        <span
          className="text-[10px] uppercase tracking-wide text-slate-500"
          title={`Bu ölçüde ${METRIC_DIRECTION_LABELS[metric.direction].toLocaleLowerCase("tr-TR")}.`}
        >
          {METRIC_DIRECTION_LABELS[metric.direction]}
        </span>
      </div>
      {metric.hint && <p className="mt-2 text-[11px] leading-4 text-slate-500">{metric.hint}</p>}
    </div>
  );
}

export function ReportCharts({ series }: { series: ReportSeries[] }) {
  const usable = series.filter((s) => s.points.length > 0);
  if (usable.length === 0) return null;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {usable.map((s) => {
        const format = (v: number) => formatValue(v, s.type, s.currency);
        const first = s.points[0]?.value ?? 0;
        const last = s.points[s.points.length - 1]?.value ?? 0;
        const trend = last - first;
        const tone = deltaTone(trend, s.direction);
        return (
          <Card
            key={s.key}
            title={s.label}
            action={
              s.chart === "CIZGI" && s.points.length > 1 ? (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${DELTA_TONE_CLASSES[tone]}`}
                  title="Dönem başından dönem sonuna değişim."
                >
                  dönem içi seyir
                </span>
              ) : undefined
            }
          >
            {s.chart === "CIZGI" ? (
              <LineChart points={s.points} format={format} label={s.label} />
            ) : (
              <BarList points={s.points} format={format} />
            )}
          </Card>
        );
      })}
    </div>
  );
}
