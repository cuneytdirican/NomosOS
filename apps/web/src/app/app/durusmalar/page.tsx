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
import { ApiError, api, fetchPaged, getStoredUser, SERVER_MAX_PAGE_SIZE } from "@/lib/api";
import type { Hearing } from "@/lib/types";
import { HearingPrepModal, parsePrep, type HearingPrepPackage } from "@/components/hearing-prep-modal";
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
  TruncationNotice,
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
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  // Faz 1: "benim duruşmalarım", sonuç girilmemiş liste, AI hazırlık paketi.
  const [onlyMine, setOnlyMine] = useState(false);
  const [pending, setPending] = useState<Hearing[]>([]);
  const [prepBusy, setPrepBusy] = useState<string | null>(null);
  const [prepView, setPrepView] = useState<{ title: string; prep: HearingPrepPackage | null; model?: string | null; warnings?: string[] } | null>(null);
  const myId = getStoredUser()?.id ?? null;

  const loadPending = useCallback(async () => {
    try {
      const res = await api<{ items: Hearing[] }>("/hearings/pending-results");
      setPending(res.items);
    } catch {
      setPending([]);
    }
  }, []);

  async function prepare(h: Hearing) {
    setActionError(null);
    setPrepBusy(h.id);
    try {
      const res = await api<{ prep: HearingPrepPackage; model?: string; warnings?: string[] }>(`/hearings/${h.id}/prep`, { method: "POST", body: {} });
      setPrepView({ title: `Hazırlık paketi — ${h.case?.title ?? "Duruşma"}`, prep: res.prep, model: res.model, warnings: res.warnings });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Hazırlık paketi üretilemedi.");
    } finally {
      setPrepBusy(null);
    }
  }

  /**
   * SAYFALAMA ZARFI OKUNUR (denetim bulgusu K-15).
   *
   * Bu ekran haftalık takvim görünümüdür; kayıtlar güne göre gruplanır, bu
   * yüzden sayfa geçişi anlamlı değildir. Ama zarfı ATMAK da kabul edilemez:
   * bir haftada 200'den fazla duruşma varsa (çok avukatlı büro + toplu icra
   * duruşmaları) fazlası SESSİZCE düşüyordu. Artık `total` okunuyor ve
   * kırpma varsa ekranda görünür uyarı çıkıyor.
   */
  const load = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPaged<Hearing>("/hearings", {
        query: { from: fromDate, to: toDate },
        page: 1,
        limit: SERVER_MAX_PAGE_SIZE,
      });
      setHearings(res.items);
      setTotal(res.total);
      setTruncated(res.hasMore || res.truncated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Duruşmalar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(from, to);
    void loadPending();
    // İlk yükleme — içinde bulunulan hafta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(() => {
    void load(from, to);
    void loadPending();
  }, [load, from, to, loadPending]);

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

  const visibleHearings = useMemo(
    () => (onlyMine && myId ? hearings.filter((h) => h.attendeeUserId === myId) : hearings),
    [hearings, onlyMine, myId],
  );
  const grouped = useMemo(() => groupByDay(visibleHearings), [visibleHearings]);
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

      {pending.length > 0 && (
        <Card title={`Sonucu girilmemiş duruşmalar (${pending.length})`}>
          <ul className="divide-y divide-slate-100">
            {pending.slice(0, 10).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-slate-900">{h.case?.title ?? "Dosya"}</span>
                  <span className="text-slate-500"> · {fmtDayHeading(h.date)} {fmtTime(h.date)}</span>
                  {h.attendee && <span className="text-slate-500"> · {h.attendee.fullName}</span>}
                </div>
                <Button size="sm" onClick={() => setResultHearing(h)}>Sonuç gir</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Aralıktaki Duruşma" value={total} tone="navy" hint={weekLabel} />
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
            {myId && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                Yalnız benim duruşmalarım
              </label>
            )}
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
        ) : visibleHearings.length === 0 ? (
          <EmptyState message={onlyMine ? "Bu aralıkta size atanmış duruşma yok." : "Seçili aralıkta duruşma bulunmuyor."} />
        ) : (
          <div className="space-y-6">
            {/* Sessiz kırpma yasak (denetim bulgusu K-15). */}
            {truncated && (
              <TruncationNotice
                shown={hearings.length}
                noun="duruşma"
                hint="Aralığı daraltın (ör. tek güne bakın) ya da haftayı bölerek listeleyin."
              />
            )}
            {grouped.map(([day, items]) => (
              <section key={day}>
                <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-900">
                  {fmtDayHeading(items[0].date)}
                  <span className="ml-2 text-xs font-normal text-slate-500">
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
                            <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
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
                              {h.attendee ? ` · Av. ${h.attendee.fullName}` : " · sorumlu avukat atanmadı"}
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
                        <Button size="sm" variant="secondary" disabled={prepBusy === h.id} onClick={() => void prepare(h)}>
                          {prepBusy === h.id ? "Hazırlanıyor…" : "AI ile hazırla"}
                        </Button>
                        {h.prepJson && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setPrepView({ title: `Hazırlık paketi — ${h.case?.title ?? "Duruşma"}`, prep: parsePrep(h.prepJson) })}
                          >
                            Paketi gör
                          </Button>
                        )}
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
      <HearingPrepModal
        open={!!prepView}
        onClose={() => setPrepView(null)}
        title={prepView?.title ?? "Hazırlık paketi"}
        prep={prepView?.prep ?? null}
        model={prepView?.model}
        warnings={prepView?.warnings}
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
