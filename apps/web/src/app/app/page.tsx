"use client";

/**
 * Partner / Avukat paneli (Modül 18 — Faz 1 kesiti).
 *
 * Birincil veri kaynağı: GET /dashboard/summary (tek çağrı).
 * Uç henüz yayında değilse eski çoklu çağrı düzenine (hearings + deadlines/upcoming
 * + tasks + cases + clients) sessizce düşer; panel her koşulda çalışır.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList, fetchPaged } from "@/lib/api";
import { firstCount, listOf } from "@/lib/dashboard";
import { listProposalsPaged } from "@/lib/faz2";
import type {
  ActionProposal,
  CaseSummary,
  Client,
  DashboardSummary,
  Deadline,
  Hearing,
  Task,
} from "@/lib/types";
import { Badge, Card, EmptyState, ErrorBox, Spinner, StatCard } from "@/components/ui";
import { TaskProgress } from "@/components/task-progress";
import { riskOffice } from "./_lib/faz4";
import type { RiskCaseRow } from "./_lib/faz4-types";
// Faz 5 — onay bekleyen mesajlar + vekaletname/sözleşme uyarıları.
import { listApprovalQueue, listContractRenewals, listPoaWarnings } from "./_lib/faz5";
import type { CommEntry, ContractRenewalItem, PoaAlert } from "./_lib/faz5-types";
// Faz 6 — aylık özet ve bildirim kartları. İkisi de kendi verisini çeker ve
// uç/rol yoksa hiç çizilmez; panelin mevcut kartlarına dokunmazlar.
import { MonthlySummaryCard, NotificationsSummaryCard } from "./_components/dashboard-faz6";
import {
  RISK_BANDS,
  RISK_BAND_BARS,
  RISK_BAND_DOTS,
  RISK_BAND_LABELS,
  RISK_BAND_TONES,
  RISK_DIMENSION_LABELS,
  riskBandOf,
  COMM_CHANNEL_LABELS,
  OUTBOUND_STATUS_LABELS,
  OUTBOUND_STATUS_TONES,
  DEADLINE_SOURCE_LABELS,
  DEADLINE_SOURCE_TONES,
  HEARING_TYPE_LABELS,
  PROPOSAL_TYPE_LABELS,
  PROPOSAL_TYPE_TONES,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_TONES,
  addDays,
  daysUntil,
  fmtDate,
  fmtDayHeading,
  fmtTime,
  labelOf,
  remainingLabel,
  startOfWeek,
  toIsoDate,
  urgencyRowClass,
  urgencyTone,
} from "@/lib/labels";

interface PanelData {
  activeCases: number;
  clientCount: number;
  openTasks: number;
  hearingCount: number;
  criticalCount: number;
  hearings: Hearing[];
  criticalDeadlines: Deadline[];
  riskyDeadlines: Deadline[];
  myTasks: Task[];
  degraded: boolean;
}

const EMPTY: PanelData = {
  activeCases: 0,
  clientCount: 0,
  openTasks: 0,
  hearingCount: 0,
  criticalCount: 0,
  hearings: [],
  criticalDeadlines: [],
  riskyDeadlines: [],
  myTasks: [],
  degraded: false,
};

export default function PanelPage() {
  const [data, setData] = useState<PanelData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  /** Sunucudaki gerçek toplam — kart ilk 50 kaydı gösterir (denetim bulgusu K-15). */
  const [proposalTotal, setProposalTotal] = useState(0);
  /** Riskli dosyalar — uç yoksa kart gizlenir, panel etkilenmez. */
  const [riskRows, setRiskRows] = useState<RiskCaseRow[]>([]);
  /** Faz 5 — onay bekleyen giden mesajlar ve vekaletname/sözleşme uyarıları. */
  const [pendingMessages, setPendingMessages] = useState<CommEntry[]>([]);
  const [poaAlerts, setPoaAlerts] = useState<PoaAlert[]>([]);
  const [renewals, setRenewals] = useState<ContractRenewalItem[]>([]);

  useEffect(() => {
    let alive = true;
    riskOffice({ limit: 100 })
      .then((rows) => {
        if (alive) setRiskRows(rows);
      })
      .catch(() => {
        if (alive) setRiskRows([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Bekleyen AI önerileri — uç yoksa kart gizlenir, panel etkilenmez. */
  useEffect(() => {
    let alive = true;
    // Zarf okunur: kart ilk 50'yi gösterir, toplam ayrıca bilinir (K-15).
    listProposalsPaged({ status: "BEKLIYOR", limit: 50 })
      .then((res) => {
        if (alive) {
          setProposals(res.items);
          setProposalTotal(res.total);
        }
      })
      .catch(() => {
        if (alive) {
          setProposals([]);
          setProposalTotal(0);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Faz 5 kartları. Üç uç da bağımsız olarak "yoksa boş" davranır: iletişim
   * modülü yayına alınmamış bir kurulumda panel eskisi gibi çalışır.
   */
  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      listApprovalQueue(),
      listPoaWarnings(),
      listContractRenewals(90),
    ]).then(([m, p, c]) => {
      if (!alive) return;
      setPendingMessages(m.status === "fulfilled" ? m.value : []);
      setPoaAlerts(p.status === "fulfilled" ? p.value : []);
      setRenewals(c.status === "fulfilled" ? c.value : []);
    });
    return () => {
      alive = false;
    };
  }, []);

  const loadLegacy = useCallback(async (): Promise<PanelData> => {
    const today = new Date();
    const weekStart = startOfWeek(today);
    /**
     * SAYIMLAR ZARFTAN OKUNUR (denetim bulgusu K-15).
     *
     * Önceden `/cases?limit=200` ve `/clients?limit=100` çekilip dizi
     * uzunluğu sayılıyordu: 640 dosyalı büroda "Aktif Dosya" kartı en fazla
     * 200, "Müvekkil" kartı en fazla 100 gösterebiliyordu — panel, büroyu
     * olduğundan küçük gösteriyordu. Artık tek kayıt istenip zarftaki `total`
     * okunur; hem doğru hem ucuz.
     *
     * "Aktif" = kapanmamış. `/cases` tek bir `status` değeri aldığı için
     * toplamdan kapanmış iki durum çıkarılır.
     */
    const [hearingsRes, deadlinesRes, tasksRes, casesRes, closedRes, archivedRes, clientsRes] =
      await Promise.allSettled([
        api<unknown>("/hearings", {
          query: { from: toIsoDate(weekStart), to: toIsoDate(addDays(weekStart, 6)) },
        }),
        api<unknown>("/deadlines/upcoming", { query: { days: 14 } }),
        api<unknown>("/tasks", { query: { status: "ACIK" } }),
        fetchPaged<CaseSummary>("/cases", { page: 1, limit: 1 }),
        fetchPaged<CaseSummary>("/cases", { query: { status: "KAPANDI" }, page: 1, limit: 1 }),
        fetchPaged<CaseSummary>("/cases", { query: { status: "ARSIV" }, page: 1, limit: 1 }),
        fetchPaged<Client>("/clients", { page: 1, limit: 1 }),
      ]);

    const hearings = hearingsRes.status === "fulfilled" ? asList<Hearing>(hearingsRes.value) : [];
    const deadlines =
      deadlinesRes.status === "fulfilled" ? asList<Deadline>(deadlinesRes.value) : [];
    const tasks = tasksRes.status === "fulfilled" ? asList<Task>(tasksRes.value) : [];
    const caseTotal = casesRes.status === "fulfilled" ? casesRes.value.total : 0;
    const closedTotal = closedRes.status === "fulfilled" ? closedRes.value.total : 0;
    const archivedTotal = archivedRes.status === "fulfilled" ? archivedRes.value.total : 0;
    const clientTotal = clientsRes.status === "fulfilled" ? clientsRes.value.total : 0;

    const critical = deadlines.filter((d) => daysUntil(d.dueDate) <= 3);
    return {
      activeCases: Math.max(0, caseTotal - closedTotal - archivedTotal),
      clientCount: clientTotal,
      openTasks: tasks.length,
      hearingCount: hearings.length,
      criticalCount: critical.length,
      hearings,
      criticalDeadlines: critical,
      riskyDeadlines: deadlines.filter(
        (d) => d.source === "AI_ONERISI" || d.status === "BEKLIYOR",
      ),
      myTasks: tasks.slice(0, 8),
      degraded: true,
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await api<DashboardSummary>("/dashboard/summary");
      const hearings = listOf<Hearing>(summary.hearingsThisWeek);
      const critical = listOf<Deadline>(summary.criticalDeadlines);
      const risky = listOf<Deadline>(summary.riskyDeadlines);
      const myTasks = listOf<Task>(summary.myTasks);
      setData({
        activeCases: firstCount(summary.activeCases, summary.counts?.activeCases),
        clientCount: firstCount(summary.clientCount, summary.counts?.clientCount),
        openTasks: firstCount(summary.openTasks, summary.counts?.openTasks, myTasks),
        hearingCount: firstCount(summary.hearingsThisWeek, summary.counts?.hearingsThisWeek),
        criticalCount: firstCount(summary.criticalDeadlines, summary.counts?.criticalDeadlines),
        hearings,
        criticalDeadlines: critical,
        riskyDeadlines: risky,
        myTasks,
        degraded: false,
      });
      setLoading(false);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setError(err.message);
        setLoading(false);
        return;
      }
      try {
        setData(await loadLegacy());
      } catch (fallbackErr) {
        setError(
          fallbackErr instanceof ApiError ? fallbackErr.message : "Panel verisi yüklenemedi.",
        );
      } finally {
        setLoading(false);
      }
    }
  }, [loadLegacy]);

  useEffect(() => {
    void load();
  }, [load]);

  const hearingCount = data.hearingCount;
  const criticalCount = data.criticalCount;

  // Duruşmaları güne göre grupla
  const hearingsByDay = groupByDay(data.hearings);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Panel</h1>
          <p className="mt-1 text-sm text-slate-500">
            Bugün müdahale etmeniz gerekenler: duruşmalar, kritik süreler ve açık görevleriniz.
          </p>
        </div>
        <p className="text-xs text-slate-400">
          {new Date().toLocaleDateString("tr-TR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      {error && <ErrorBox message={error} />}

      {loading ? (
        <Spinner label="Panel hazırlanıyor…" />
      ) : (
        <>
          {/* KPI şeridi */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Aktif Dosya"
              value={data.activeCases}
              hint="Kapanmamış dava, icra ve danışmanlık"
              tone="navy"
              href="/app/dosyalar"
            />
            <StatCard
              label="Bu Hafta Duruşma"
              value={hearingCount}
              hint="Pazartesi–Pazar aralığı"
              tone="slate"
              href="/app/durusmalar"
            />
            <StatCard
              label="Kritik Süre"
              value={criticalCount}
              hint="3 gün ve altı"
              tone={criticalCount > 0 ? "red" : "slate"}
              href="/app/sureler"
            />
            <StatCard
              label="Açık Görev"
              value={data.openTasks}
              hint="Tamamlanmamış görevler"
              tone="slate"
              href="/app/gorevler"
            />
            <StatCard
              label="Müvekkil"
              value={data.clientCount}
              hint="Kayıtlı müvekkil sayısı"
              tone="gold"
              href="/app/muvekkiller"
            />
          </div>

          {/* Faz 6 — bu ay özeti (deterministik rapor motorundan) ve bildirimler.
              KPI şeridinin hemen altında dururlar: şerit "şu an ne var"ı,
              bu iki kart "bu ay ne oldu / neyi kaçırıyor olabilirim"i söyler. */}
          {/* `empty:hidden` — iki kart da gizlendiğinde sarmalayıcı boş bir
              satır aralığı bırakmaz. */}
          <div className="grid gap-6 empty:hidden xl:grid-cols-2">
            <MonthlySummaryCard />
            <NotificationsSummaryCard />
          </div>

          {/* Bekleyen AI önerileri — belge hattının ürettiği aksiyonlar */}
          {proposals.length > 0 && (
            <Card
              title={`Bekleyen Öneriler (${proposalTotal || proposals.length})`}
              action={
                <Link
                  href="/app/oneriler"
                  className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-400"
                >
                  Onay kuyruğuna git →
                </Link>
              }
            >
              <p className="text-xs text-slate-500">
                Yüklenen belgelerden AI&apos;ın çıkardığı görev, süre ve safahat önerileri. Siz
                onaylamadan hiçbiri kayda geçmez.
              </p>
              <ul className="mt-3 space-y-2">
                {proposals.slice(0, 5).map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{p.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {p.case?.title ? `${p.case.title} · ` : ""}
                        {p.document?.name ?? "kaynak belge —"}
                      </p>
                    </div>
                    <Badge tone={PROPOSAL_TYPE_TONES[p.type] ?? "gray"}>
                      {labelOf(PROPOSAL_TYPE_LABELS, p.type)}
                    </Badge>
                  </li>
                ))}
              </ul>
              {(proposalTotal || proposals.length) > 5 && (
                <p className="mt-2 text-xs text-slate-400">
                  ve {(proposalTotal || proposals.length) - 5} öneri daha…
                </p>
              )}
            </Card>
          )}

          {/* Onay bekleyen giden mesajlar — İletişim Merkezi (Modül 19) */}
          {pendingMessages.length > 0 && <PendingMessagesCard entries={pendingMessages} />}

          {/* Vekaletname ve sözleşme uyarıları — Modül 12 + 20 */}
          {(poaAlerts.length > 0 || renewals.length > 0) && (
            <PoaContractAlertsCard alerts={poaAlerts} renewals={renewals} />
          )}

          {/* Riskli dosyalar — Risk Motoru (Modül 17) beslemesi */}
          {riskRows.length > 0 && <RiskyCasesCard rows={riskRows} />}

          {/* Onay bekleyen / riskli süre uyarısı */}
          {data.riskyDeadlines.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    {data.riskyDeadlines.length} süre onay bekliyor veya risk taşıyor
                  </p>
                  <p className="mt-0.5 text-xs text-amber-800">
                    AI önerileri avukat onayı olmadan kesin süre sayılmaz — inceleyip onaylayın.
                  </p>
                </div>
                <Link
                  href="/app/sureler"
                  className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-400"
                >
                  İncele ve Onayla →
                </Link>
              </div>
              <ul className="mt-3 space-y-1">
                {data.riskyDeadlines.slice(0, 3).map((d) => (
                  <li key={d.id} className="text-xs text-amber-900">
                    • {d.title} — {fmtDate(d.dueDate)}
                    {d.case?.title ? ` · ${d.case.title}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Üç sütun */}
          <div className="grid gap-6 xl:grid-cols-3">
            {/* Bu haftaki duruşmalar */}
            <Card
              title="Bu Haftaki Duruşmalar"
              action={
                <Link
                  href="/app/durusmalar"
                  className="text-xs font-medium text-amber-600 hover:text-amber-500"
                >
                  Tümü →
                </Link>
              }
            >
              {data.hearings.length === 0 ? (
                <EmptyState message="Bu hafta planlı duruşma yok." />
              ) : (
                <div className="space-y-4">
                  {hearingsByDay.map(([day, items]) => (
                    <div key={day}>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {fmtDayHeading(items[0].date)}
                      </p>
                      <ul className="space-y-2">
                        {items.map((h) => (
                          <li
                            key={h.id}
                            className="rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-300"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900">
                                  {fmtTime(h.date)}
                                  {h.courtroom ? ` · Salon ${h.courtroom}` : ""}
                                </p>
                                <p className="truncate text-xs text-slate-600">
                                  {h.case ? (
                                    <Link
                                      href={`/app/dosyalar/${h.case.id}`}
                                      className="hover:text-amber-600"
                                    >
                                      {h.case.title}
                                    </Link>
                                  ) : (
                                    "Dosya"
                                  )}
                                </p>
                                {h.case?.courtName && (
                                  <p className="truncate text-[11px] text-slate-400">
                                    {h.case.courtName}
                                  </p>
                                )}
                              </div>
                              <Badge tone="navy">{labelOf(HEARING_TYPE_LABELS, h.type)}</Badge>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Kritik süreler */}
            <Card
              title="Kritik Süreler"
              action={
                <Link
                  href="/app/sureler"
                  className="text-xs font-medium text-amber-600 hover:text-amber-500"
                >
                  Tümü →
                </Link>
              }
            >
              {data.criticalDeadlines.length === 0 ? (
                <EmptyState message="Kritik süre yok. Takvim temiz." />
              ) : (
                <ul className="space-y-2">
                  {data.criticalDeadlines.map((d) => {
                    const days = daysUntil(d.dueDate);
                    return (
                      <li
                        key={d.id}
                        className={`rounded-lg border border-slate-200 px-3 py-2.5 ${urgencyRowClass(days)}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">{d.title}</p>
                            <p className="mt-0.5 truncate text-xs text-slate-500">
                              {fmtDate(d.dueDate)}
                              {d.case?.title ? ` · ${d.case.title}` : ""}
                            </p>
                            {d.legalBasis && (
                              <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                {d.legalBasis}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Badge tone={urgencyTone(days)}>{remainingLabel(days)}</Badge>
                            {d.source && (
                              <Badge tone={DEADLINE_SOURCE_TONES[d.source] ?? "gray"}>
                                {labelOf(DEADLINE_SOURCE_LABELS, d.source)}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {/* Görevlerim */}
            <Card
              title="Görevlerim"
              action={
                <Link
                  href="/app/gorevler"
                  className="text-xs font-medium text-amber-600 hover:text-amber-500"
                >
                  Tümü →
                </Link>
              }
            >
              {data.myTasks.length === 0 ? (
                <EmptyState message="Açık göreviniz yok. Harika!" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.myTasks.map((t) => (
                    <li key={t.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{t.title}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {t.dueDate ? `Son tarih: ${fmtDate(t.dueDate)}` : "Son tarih yok"}
                            {t.case?.title ? ` · ${t.case.title}` : ""}
                          </p>
                        </div>
                        {t.priority && (
                          <Badge tone={TASK_PRIORITY_TONES[t.priority] ?? "gray"}>
                            {labelOf(TASK_PRIORITY_LABELS, t.priority)}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-2">
                        <TaskProgress status={t.status} compact />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {data.degraded && (
            <p className="text-xs text-slate-400">
              Not: <code>/dashboard/summary</code> ucuna ulaşılamadığı için panel tekil uçlardan
              derlendi.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Onay bekleyen mesajlar kartı (Modül 19).
 *
 * Panelde durmasının nedeni: onaylanmamış bir taslak, MÜVEKKİLE ULAŞMAMIŞ bir
 * bilgilendirmedir. Kuyrukta unutulan mesaj, avukatın "bilgi verdim" sandığı
 * ama verilmemiş bir iştir — kritik süreler kadar görünür olmalıdır.
 */
function PendingMessagesCard({ entries }: { entries: CommEntry[] }) {
  return (
    <Card
      title={`Onay Bekleyen Mesajlar (${entries.length})`}
      action={
        <Link
          href="/app/iletisim"
          className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-400"
        >
          İletişim Merkezi&apos;ne git →
        </Link>
      }
    >
      <p className="text-xs text-slate-500">
        Bu mesajlar HENÜZ GÖNDERİLMEDİ. Onaylayan kullanıcı, gönderilen metnin sorumlusudur.
      </p>
      <ul className="mt-3 space-y-2">
        {entries.slice(0, 5).map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {e.subject ?? `${labelOf(COMM_CHANNEL_LABELS, e.channel)} mesajı`}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {e.client?.name ?? "Müvekkil"}
                {e.case?.title ? ` · ${e.case.title}` : ""}
              </p>
            </div>
            <Badge tone={OUTBOUND_STATUS_TONES[e.status ?? ""] ?? "gray"}>
              {labelOf(OUTBOUND_STATUS_LABELS, e.status)}
            </Badge>
          </li>
        ))}
      </ul>
      {entries.length > 5 && (
        <p className="mt-2 text-xs text-slate-400">ve {entries.length - 5} mesaj daha…</p>
      )}
    </Card>
  );
}

/**
 * Vekaletname ve sözleşme uyarıları (Modül 12 + 20).
 *
 * İki kaynak TEK kartta toplanır çünkü ikisi de aynı soruyu sorar: "bu işi
 * yapmaya hâlâ yetkili miyiz / bu ilişki hâlâ yürürlükte mi?". Süresi dolan
 * vekaletname ile yapılan usul işlemi ve kaçırılan fesih ihbarı, avukata aynı
 * anda görünmesi gereken iki risktir.
 */
function PoaContractAlertsCard({
  alerts,
  renewals,
}: {
  alerts: PoaAlert[];
  renewals: ContractRenewalItem[];
}) {
  return (
    <Card title={`Vekaletname ve Sözleşme Uyarıları (${alerts.length + renewals.length})`}>
      {alerts.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Vekaletname
          </p>
          <ul className="mt-2 space-y-2">
            {alerts.slice(0, 5).map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-900">{a.message}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {a.client?.id ? (
                      <Link
                        href={`/app/muvekkiller/${a.client.id}`}
                        className="hover:text-amber-600"
                      >
                        {a.client.name ?? "Müvekkil"}
                      </Link>
                    ) : (
                      "Müvekkil"
                    )}
                    {a.expiresAt ? ` · bitiş: ${fmtDate(a.expiresAt)}` : ""}
                  </p>
                </div>
                {a.daysLeft !== null && (
                  <Badge tone={urgencyTone(a.daysLeft)}>{remainingLabel(a.daysLeft)}</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {renewals.length > 0 && (
        <div className={alerts.length > 0 ? "mt-4" : ""}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Sözleşme yenileme / fesih ihbarı
          </p>
          <ul className="mt-2 space-y-2">
            {renewals.slice(0, 5).map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-900">{r.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {r.client?.name ?? "Müvekkil"}
                    {r.noticeDeadline ? ` · ihbar son gün: ${fmtDate(r.noticeDeadline)}` : ""}
                    {r.autoRenew ? " · kendiliğinden yenilenir" : ""}
                  </p>
                </div>
                {r.daysLeft !== null && (
                  <Badge tone={urgencyTone(r.daysLeft)}>{remainingLabel(r.daysLeft)}</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-5 text-slate-400">
        Süre hesapları sunucudaki deterministik süre motorundan gelir; bu kart yalnızca gösterir.
      </p>
    </Card>
  );
}

/**
 * Riskli dosyalar kartı — bant dağılımı + en riskli 5 dosya.
 *
 * Sayılar `GET /risk/office` satırlarından türetilir; böylece panel ile
 * `/app/riskli-dosyalar` sayfası AYNI kaynaktan beslenir ve iki ekran farklı
 * sayı göstermez (Modül 17, kabul kriteri 6).
 */
function RiskyCasesCard({ rows }: { rows: RiskCaseRow[] }) {
  const counts: Record<string, number> = { DUSUK: 0, ORTA: 0, YUKSEK: 0 };
  for (const r of rows) {
    const key = String(r.band ?? riskBandOf(r.score));
    if (counts[key] !== undefined) counts[key] += 1;
  }
  const top = [...rows].sort((a, b) => b.score - a.score).slice(0, 5);

  return (
    <Card
      title={`Riskli Dosyalar (${counts.YUKSEK} yüksek · ${counts.ORTA} orta)`}
      action={
        <Link
          href="/app/riskli-dosyalar"
          className="text-xs font-medium text-amber-600 hover:text-amber-500"
        >
          Tümü →
        </Link>
      }
    >
      <div className="flex flex-wrap gap-2">
        {RISK_BANDS.map((b) => (
          <span
            key={b}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
          >
            {RISK_BAND_DOTS[b]} {labelOf(RISK_BAND_LABELS, b)}:{" "}
            <strong className="text-slate-900">{counts[b] ?? 0}</strong>
          </span>
        ))}
      </div>

      <ul className="mt-3 space-y-2">
        {top.map((r) => {
          const band = String(r.band ?? riskBandOf(r.score));
          const title = r.case?.title ?? r.caseTitle ?? "Dosya";
          const top1 = r.topDimension ?? r.dimension ?? null;
          return (
            <li
              key={r.caseId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
            >
              <div className="min-w-0">
                <Link
                  href={`/app/dosyalar/${r.caseId}?sekme=risk`}
                  className="text-sm font-medium text-slate-900 hover:text-amber-600"
                >
                  {title}
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  {top1
                    ? `Baskın boyut: ${labelOf(RISK_DIMENSION_LABELS, String(top1))}`
                    : "Genel skor"}
                  {r.responsibleUser?.fullName ? ` · ${r.responsibleUser.fullName}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className={`block h-full rounded-full ${RISK_BAND_BARS[band] ?? "bg-slate-400"}`}
                    style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }}
                  />
                </span>
                <Badge tone={RISK_BAND_TONES[band] ?? "gray"}>{r.score}</Badge>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-5 text-slate-400">
        Skor tabanı deterministik kural sinyalleridir; AI düzeltmesi ±25 ile sınırlıdır ve
        bandı tek başına değiştiremez.
      </p>
    </Card>
  );
}

/** Duruşmaları takvim gününe göre gruplar (sıralı). */
function groupByDay(hearings: Hearing[]): Array<[string, Hearing[]]> {
  const map = new Map<string, Hearing[]>();
  for (const h of [...hearings].sort((a, b) => a.date.localeCompare(b.date))) {
    const d = new Date(h.date);
    if (Number.isNaN(d.getTime())) continue;
    const key = toIsoDate(d);
    const bucket = map.get(key);
    if (bucket) bucket.push(h);
    else map.set(key, [h]);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
