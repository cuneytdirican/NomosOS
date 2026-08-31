"use client";

/**
 * Panel kartları — Faz 6 eklemeleri (Modül 18).
 *
 * İKİ KART, İKİ SORU:
 *   • "Bu ay özet"  → büro bu ay ne üretti? (deterministik rapor motorundan)
 *   • "Bildirimler" → bugün gözden kaçan bir uyarı var mı?
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ İKİ KART DA KENDİ BAŞINA SESSİZ ÖLÜR.                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Rapor motoru ya da bildirim hattı yayında değilse — veya kullanıcının rolü
 * ilgili rapora kapalıysa (STAJYER finans) — kart HİÇ ÇİZİLMEZ. Panelde hata
 * kutusu göstermek, avukatın gerçekten müdahale etmesi gereken kritik süre ve
 * duruşma kartlarının önüne gürültü koymak olurdu.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, DeltaIndicator } from "@/components/ui";
import {
  NOTIFICATION_KIND_ICONS,
  NOTIFICATION_KIND_LABELS,
  deltaTone,
  fmtDeltaPercent,
  fmtRelativeTime,
  isCriticalNotification,
  labelOf,
  periodLabel,
  resolvePeriod,
} from "@/lib/labels";
import { formatDelta, formatValue } from "../_lib/faz6-format";
import {
  NOTIFICATIONS_CHANGED_EVENT,
  fetchNotifications,
  runReport,
  sortNotifications,
} from "../_lib/faz6";
import type { NotificationItem, ReportMetric } from "../_lib/faz6-types";

/**
 * Panelde gösterilecek aylık özet raporunun anahtarı.
 *
 * Tohumlanan `buro-aylik-ozet` raporu kullanılır — panel ile Raporlar sayfası
 * AYNI kaynaktan beslenir ve iki ekran farklı sayı göstermez.
 */
const MONTHLY_REPORT_KEY = "buro-aylik-ozet";

/** Kartta öncelikli gösterilecek ölçüler (bulunamazsa ilk üç ölçü kullanılır). */
const PREFERRED_METRIC_KEYS = [
  "yeniDosya",
  "acilanDosya",
  "tamamlananGorev",
  "tahsilat",
  "tahsilEdilen",
];

export function MonthlySummaryCard() {
  const [metrics, setMetrics] = useState<ReportMetric[] | null>(null);
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const range = resolvePeriod("BU_AY");
    setPeriod(range);
    runReport(MONTHLY_REPORT_KEY, {
      from: range.from,
      to: range.to,
      compare: true,
      filters: {},
    })
      .then((res) => {
        if (alive) setMetrics(res.metrics);
      })
      .catch(() => {
        // Uç yok, rapor yok ya da rol kapalı — kart sessizce gizlenir.
        if (alive) setMetrics(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!metrics || metrics.length === 0) return null;

  const preferred = PREFERRED_METRIC_KEYS.map((k) => metrics.find((m) => m.key === k)).filter(
    (m): m is ReportMetric => Boolean(m),
  );
  const shown = (preferred.length > 0 ? preferred : metrics).slice(0, 3);

  return (
    <Card
      title="Bu Ay Özet"
      action={
        <Link
          href={`/app/raporlar/${MONTHLY_REPORT_KEY}`}
          className="text-xs font-medium text-amber-600 hover:text-amber-500"
        >
          Raporu aç →
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {shown.map((m) => (
          <div key={m.key} className="rounded-lg border border-slate-200 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {m.label}
            </p>
            <p className="mt-1 text-xl font-bold leading-none tabular-nums text-slate-900">
              {formatValue(m.value, m.type, m.currency)}
            </p>
            <div className="mt-2">
              <DeltaIndicator
                delta={m.delta}
                tone={deltaTone(m.delta, m.direction)}
                valueText={formatDelta(m.delta, m.type, m.currency)}
                percentText={m.deltaPercent === null ? undefined : fmtDeltaPercent(m.deltaPercent)}
                previousText={
                  m.previous === null ? undefined : formatValue(m.previous, m.type, m.currency)
                }
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-400">
        {period ? `${periodLabel(period.from, period.to)} · ` : ""}
        Rakamlar deterministik olarak veritabanından hesaplanır. Fark rengi metriğin
        &quot;iyi yönüne&quot; göredir: her artış olumlu sayılmaz.
      </p>
    </Card>
  );
}

export function NotificationsSummaryCard() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchNotifications({ limit: 20 })
        .then((feed) => {
          if (!alive) return;
          setItems(sortNotifications(feed.items, isCriticalNotification));
          setUnread(feed.unreadCount);
          setReady(true);
        })
        .catch(() => {
          if (alive) setReady(false);
        });
    };
    load();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, load);
    };
  }, []);

  if (!ready || items.length === 0) return null;

  const critical = items.filter((n) => isCriticalNotification(n.kind) && !n.readAt);
  const top = items.filter((n) => !n.readAt).slice(0, 4);
  if (top.length === 0) return null;

  return (
    <Card
      title={`Bildirimler (${unread} okunmamış)`}
      action={
        critical.length > 0 ? (
          <Badge tone="danger">{critical.length} kritik</Badge>
        ) : undefined
      }
    >
      <ul className="space-y-2">
        {top.map((n) => {
          const isCrit = isCriticalNotification(n.kind);
          const body = (
            <div
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                isCrit ? "border-red-300 bg-red-50/60" : "border-slate-200"
              }`}
            >
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-base leading-none">
                {NOTIFICATION_KIND_ICONS[n.kind] ?? "🔔"}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm leading-5 ${
                    isCrit ? "font-bold text-red-900" : "font-medium text-slate-900"
                  }`}
                >
                  {n.title}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {labelOf(NOTIFICATION_KIND_LABELS, n.kind)} ·{" "}
                  {fmtRelativeTime(n.sentAt ?? n.createdAt)}
                </p>
              </div>
            </div>
          );
          return (
            <li key={n.id}>
              {n.href ? (
                <Link href={n.href} className="block hover:opacity-90">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] leading-5 text-slate-400">
        Tümünü üst çubuktaki zil simgesinden görebilirsiniz. Bildirimi okundu işaretlemek
        kaynak kaydı (süre, görev, fatura) <strong>kapatmaz</strong>.
      </p>
    </Card>
  );
}
