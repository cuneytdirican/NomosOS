"use client";

/**
 * Duruşmalar — haftalık görünüm, gün gruplaması ve sonuç girme akışı.
 *
 * GET    /hearings?from=&to=  — aralık listesi
 * POST   /hearings            — yeni duruşma
 * PATCH  /hearings/:id        — düzenleme
 * PATCH  /hearings/:id/result — sonuç + safahat kaydı
 * DELETE /hearings/:id        — sil
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList } from "@/lib/api";
import type { Hearing } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Spinner,
  StatCard,
} from "@/components/ui";
import { HearingFormModal, HearingResultModal } from "@/components/hearing-modal";
import {
  HEARING_STATUS_LABELS,
  HEARING_STATUS_TONES,
  HEARING_TYPE_LABELS,
  addDays,
  fmtDayHeading,
  fmtTime,
  labelOf,
  startOfWeek,
  toIsoDate,
} from "@/lib/labels";

export default function DurusmalarPage() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [from, setFrom] = useState(() => toIsoDate(startOfWeek(new Date())));
  const [to, setTo] = useState(() => toIsoDate(addDays(startOfWeek(new Date()), 6)));
  const [hearings, setHearings] = useState<Hearing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Hearing | null>(null);
  const [resultHearing, setResultHearing] = useState<Hearing | null>(null);

  const load = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>("/hearings", { query: { from: fromDate, to: toDate, limit: "200" } });
      setHearings(asList<Hearing>(data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Duruşmalar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(from, to);
    // İlk yükleme — içinde bulunulan hafta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(() => void load(from, to), [load, from, to]);

  function shiftWeek(offset: number) {
    const next = addDays(weekStart, offset * 7);
    const nextFrom = toIsoDate(next);
    const nextTo = toIsoDate(addDays(next, 6));
    setWeekStart(next);
    setFrom(nextFrom);
    setTo(nextTo);
    void load(nextFrom, nextTo);
  }

  function goToday() {
    const ws = startOfWeek(new Date());
    const nextFrom = toIsoDate(ws);
    const nextTo = toIsoDate(addDays(ws, 6));
    setWeekStart(ws);
    setFrom(nextFrom);
    setTo(nextTo);
    void load(nextFrom, nextTo);
  }

  async function remove(h: Hearing) {
    if (!window.confirm("Duruşma kaydı silinsin mi?")) return;
    setActionError(null);
    try {
      await api(`/hearings/${h.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Duruşma silinemedi.");
    }
  }

  const grouped = useMemo(() => groupByDay(hearings), [hearings]);
  const planned = hearings.filter((h) => h.status === "PLANLANDI").length;
  const done = hearings.filter((h) => h.status === "YAPILDI").length;
  const postponed = hearings.filter((h) => h.status === "ERTELENDI").length;

  const weekLabel = `${new Date(from).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
  })} – ${new Date(to).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Duruşmalar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Haftalık duruşma, keşif ve e-duruşma takviminiz.
          </p>
        </div>
        <Button
          variant="gold"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          + Yeni Duruşma
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Aralıktaki Duruşma" value={hearings.length} tone="navy" hint={weekLabel} />
        <StatCard label="Planlandı" value={planned} tone="slate" />
        <StatCard label="Yapıldı" value={done} tone="green" />
        <StatCard label="Ertelendi" value={postponed} tone="slate" />
      </div>

      <Card>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => shiftWeek(-1)}>
              ← Önceki hafta
            </Button>
            <Button variant="secondary" size="sm" onClick={goToday}>
              Bu hafta
            </Button>
            <Button variant="secondary" size="sm" onClick={() => shiftWeek(1)}>
              Sonraki hafta →
            </Button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(from, to);
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <Field label="Başlangıç">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
            </Field>
            <Field label="Bitiş">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
            </Field>
            <Button type="submit" disabled={loading}>
              Listele
            </Button>
          </form>
        </div>

        {actionError && (
          <div className="mb-4">
            <ErrorBox message={actionError} />
          </div>
        )}

        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} />
        ) : hearings.length === 0 ? (
          <EmptyState message="Seçili aralıkta duruşma bulunmuyor." />
        ) : (
          <div className="space-y-6">
            {grouped.map(([day, items]) => (
              <section key={day}>
                <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-900">
                  {fmtDayHeading(items[0].date)}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {items.length} duruşma
                  </span>
                </h3>
                <ul className="space-y-3">
                  {items.map((h) => (
                    <li
                      key={h.id}
                      className="rounded-lg border border-slate-200 px-4 py-3 hover:border-slate-300"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-4">
                          <div className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-center">
                            <p className="text-base font-bold leading-none text-amber-400">
                              {fmtTime(h.date)}
                            </p>
                            <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                              {labelOf(HEARING_TYPE_LABELS, h.type)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {h.case ? (
                                <Link
                                  href={`/app/dosyalar/${h.case.id}`}
                                  className="hover:text-amber-600"
                                >
                                  {h.case.title}
                                  {h.case.fileNumber ? ` (${h.case.fileNumber})` : ""}
                                </Link>
                              ) : (
                                "Dosya"
                              )}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {h.case?.courtName ?? "—"}
                              {h.courtroom ? ` · Salon ${h.courtroom}` : ""}
                              {h.case?.client?.name ? ` · ${h.case.client.name}` : ""}
                            </p>
                            {h.prepSummary && (
                              <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                                Hazırlık: {h.prepSummary}
                              </p>
                            )}
                            {h.note && <p className="mt-1 text-xs text-slate-600">{h.note}</p>}
                          </div>
                        </div>
                        <Badge tone={HEARING_STATUS_TONES[h.status ?? ""] ?? "blue"}>
                          {labelOf(HEARING_STATUS_LABELS, h.status)}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => setResultHearing(h)}>
                          Sonuç Gir
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditing(h);
                            setFormOpen(true);
                          }}
                        >
                          Düzenle
                        </Button>
                        {h.case && (
                          <Link
                            href={`/app/dosyalar/${h.case.id}`}
                            className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                          >
                            Dosyaya git →
                          </Link>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => void remove(h)}>
                          Sil
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      <HearingFormModal
        open={formOpen}
        hearing={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={reload}
      />

      <HearingResultModal
        open={resultHearing !== null}
        hearing={resultHearing}
        onClose={() => setResultHearing(null)}
        onSaved={reload}
      />
    </div>
  );
}

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
