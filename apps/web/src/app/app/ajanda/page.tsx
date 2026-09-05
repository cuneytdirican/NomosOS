"use client";

/**
 * BİRLEŞİK AJANDA — kurumsal takvim (Modül: "enterprise++" takvim).
 *
 * GET /agenda?from=&to= — dört kaynak tek yanıtta:
 *   DURUSMA (amber) · RANDEVU (mavi) · SURE (kırmızı) · GOREV (yeşil)
 * Gün hücreleri resmî tatil / adli tatil / hafta sonu işaretli; tıklanan günün
 * ayrıntısı alt panelde açılır.
 *
 * Yapı: ay görünümü (6 hafta ızgarası) + tür süzgeçleri + ay ileri/geri/bugün.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, Card, CopyOnceField, EmptyState, ErrorBox, Modal, Spinner } from "@/components/ui";

interface AgendaEvent {
  id: string;
  kind: "DURUSMA" | "RANDEVU" | "SURE" | "GOREV";
  title: string;
  date: string;
  endAt?: string;
  caseId?: string | null;
  caseTitle?: string | null;
  clientName?: string | null;
  assigneeName?: string | null;
  location?: string | null;
  note?: string | null;
  legalBasis?: string | null;
}

interface AgendaDay {
  date: string;
  isOfficialHoliday: boolean;
  holidayName: string | null;
  isJudicialRecess: boolean;
  isWeekend: boolean;
}

interface AgendaResponse {
  from: string;
  to: string;
  events: AgendaEvent[];
  days: AgendaDay[];
  counts: Record<string, number>;
}

const KIND_META: Record<AgendaEvent["kind"], { label: string; dot: string; chip: string }> = {
  DURUSMA: { label: "Duruşma", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-900" },
  RANDEVU: { label: "Randevu", dot: "bg-blue-500", chip: "bg-blue-100 text-blue-900" },
  SURE: { label: "Süre", dot: "bg-red-500", chip: "bg-red-100 text-red-900" },
  GOREV: { label: "Görev", dot: "bg-emerald-600", chip: "bg-emerald-100 text-emerald-900" },
};

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

export default function AjandaPage() {
  const today = new Date();
  const [cursor, setCursor] = useState(
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
  );
  const [data, setData] = useState<AgendaResponse | null>(null);
  // Faz 1: ICS takvim aboneliği (Google/Outlook/Apple "URL ile abone ol").
  const [icsUrl, setIcsUrl] = useState<string | null>(null);
  const [icsError, setIcsError] = useState<string | null>(null);
  async function subscribeIcs() {
    setIcsError(null);
    try {
      const res = await api<{ url: string; expiresInDays: number }>("/agenda/feed-token", { method: "POST", body: {} });
      setIcsUrl(res.url);
    } catch (err) {
      setIcsError(err instanceof ApiError ? err.message : "Takvim bağlantısı üretilemedi.");
    }
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(isoDay(today));
  const [kindFilter, setKindFilter] = useState<Set<AgendaEvent["kind"]>>(
    new Set(["DURUSMA", "RANDEVU", "SURE", "GOREV"]),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Ay başı ± 1 hafta pay: ay ızgarası komşu ayların günlerini de gösterir.
      const from = new Date(cursor);
      from.setUTCDate(from.getUTCDate() - 7);
      const to = new Date(cursor);
      to.setUTCMonth(to.getUTCMonth() + 1);
      to.setUTCDate(to.getUTCDate() + 7);
      const res = await api<AgendaResponse>("/agenda", {
        query: { from: isoDay(from), to: isoDay(to) },
      });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ajanda yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  useMemo(() => {
    void load();
    return null;
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaEvent[]>();
    for (const e of data?.events ?? []) {
      if (!kindFilter.has(e.kind)) continue;
      const key = e.date.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [data, kindFilter]);

  const dayMeta = useMemo(() => {
    const map = new Map<string, AgendaDay>();
    for (const d of data?.days ?? []) map.set(d.date, d);
    return map;
  }, [data]);

  /** Ay ızgarası: pazartesi başlangıçlı 6×7. */
  const grid = useMemo(() => {
    const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    // Pazartesi=0 … Pazar=6
    const startOffset = (first.getUTCDay() + 6) % 7;
    const cells: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(first);
      d.setUTCDate(d.getUTCDate() - startOffset + i);
      cells.push({ date: d, inMonth: d.getUTCMonth() === cursor.getUTCMonth() });
    }
    return cells;
  }, [cursor]);

  const selectedEvents = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  function toggleKind(kind: AgendaEvent["kind"]) {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ajanda</h1>
          <p className="mt-1 text-sm text-slate-500">
            Duruşmalar, randevular, süreler ve görev teslimleri — tek takvimde.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void subscribeIcs()}>
            Takvime abone ol
          </Button>
          <Button
            variant="secondary"
            onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1)))}
          >
            ← Önceki
          </Button>
          <span className="min-w-40 text-center text-lg font-semibold text-slate-800">
            {MONTHS[cursor.getUTCMonth()]} {cursor.getUTCFullYear()}
          </span>
          <Button
            variant="secondary"
            onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)))}
          >
            Sonraki →
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setCursor(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
              setSelectedDay(isoDay(today));
            }}
          >
            Bugün
          </Button>
        </div>
      </div>

      {/* Tür süzgeçleri + sayaçlar */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(KIND_META) as AgendaEvent["kind"][]).map((kind) => {
          const active = kindFilter.has(kind);
          const count = data?.counts?.[kind] ?? 0;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-slate-300 bg-white text-slate-800"
                  : "border-slate-200 bg-slate-100 text-slate-500 line-through"
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${KIND_META[kind].dot}`} />
              {KIND_META[kind].label}
              <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{count}</span>
            </button>
          );
        })}
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data ? (
        <Card>
          <div className="p-6">
            <Spinner label="Ajanda yükleniyor…" />
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          {/* Ay ızgarası */}
          <Card className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.map(({ date, inMonth }) => {
                const key = isoDay(date);
                const meta = dayMeta.get(key);
                const events = byDay.get(key) ?? [];
                const isToday = key === isoDay(today);
                const isSel = key === selectedDay;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDay(key)}
                    className={`relative min-h-24 border-b border-r border-slate-100 p-1.5 text-left align-top transition-colors ${
                      isSel ? "bg-amber-50 ring-1 ring-inset ring-amber-400" : "hover:bg-slate-50"
                    } ${inMonth ? "" : "opacity-40"} ${
                      meta?.isOfficialHoliday ? "bg-red-50/60" : meta?.isWeekend ? "bg-slate-50/70" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                          isToday ? "bg-slate-900 text-white" : "text-slate-700"
                        }`}
                      >
                        {date.getUTCDate()}
                      </span>
                      {meta?.isOfficialHoliday && (
                        <span title={meta.holidayName ?? "Resmî tatil"} className="text-[10px] font-medium text-red-700">
                          ●
                        </span>
                      )}
                      {meta?.isJudicialRecess && !meta?.isOfficialHoliday && (
                        <span title="Adli tatil" className="text-[10px] font-medium text-slate-500">
                          ▲
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {events.slice(0, 3).map((e) => (
                        <div key={e.id} className={`truncate rounded px-1 py-0.5 text-[10px] leading-4 ${KIND_META[e.kind].chip}`}>
                          {e.kind === "DURUSMA" || e.kind === "RANDEVU" ? `${fmtTime(e.date)} ` : ""}
                          {e.title}
                        </div>
                      ))}
                      {events.length > 3 && (
                        <div className="px-1 text-[10px] text-slate-500">+{events.length - 3} daha</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Gün ayrıntısı */}
          <Card>
            <div className="border-b border-slate-100 p-4">
              <p className="text-sm font-semibold text-slate-800">
                {selectedDay
                  ? new Date(selectedDay).toLocaleDateString("tr-TR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      weekday: "long",
                    })
                  : "Gün seçin"}
              </p>
              {selectedDay && dayMeta.get(selectedDay)?.holidayName && (
                <p className="mt-1 text-xs font-medium text-red-700">
                  Resmî tatil: {dayMeta.get(selectedDay)?.holidayName}
                </p>
              )}
              {selectedDay && dayMeta.get(selectedDay)?.isJudicialRecess && (
                <p className="mt-0.5 text-[11px] text-slate-500">Adli tatil dönemi (HMK m.102)</p>
              )}
            </div>
            <div className="max-h-[520px] space-y-2 overflow-y-auto p-4">
              {selectedEvents.length === 0 ? (
                <EmptyState message="Bu gün için kayıt yok." />
              ) : (
                selectedEvents.map((e) => (
                  <div key={e.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${KIND_META[e.kind].chip}`}>
                        {KIND_META[e.kind].label}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {e.kind === "SURE" ? "Gün sonu" : fmtTime(e.date)}
                        {e.endAt ? ` – ${fmtTime(e.endAt)}` : ""}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-slate-900">{e.title}</p>
                    <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                      {e.caseId && e.caseTitle && (
                        <p>
                          Dosya:{" "}
                          <Link href={`/app/dosyalar/${e.caseId}`} className="font-medium text-amber-700 underline">
                            {e.caseTitle}
                          </Link>
                        </p>
                      )}
                      {e.clientName && <p>Müvekkil: {e.clientName}</p>}
                      {e.assigneeName && <p>Atanan: {e.assigneeName}</p>}
                      {e.location && <p>Yer: {e.location}</p>}
                      {e.legalBasis && <p className="text-slate-500">Dayanak: {e.legalBasis}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      <p className="text-center text-[11px] text-slate-500">
        ● resmî tatil · ▲ adli tatil · Süreler gün sonuna kadandır (HMK m.93); duruşma ve randevular saat iledir.
      </p>
      <Modal open={!!icsUrl || !!icsError} onClose={() => { setIcsUrl(null); setIcsError(null); }} title="Takvime abone ol (ICS)">
        {icsError ? (
          <ErrorBox message={icsError} />
        ) : icsUrl ? (
          <div className="space-y-3">
            <CopyOnceField label="Takvim bağlantınız (kişisel — paylaşmayın)" value={icsUrl} />
            <p className="text-xs text-slate-500">
              Google Takvim: Diğer takvimler → URL ile ekle. Outlook: Takvim ekle → İnternet'ten abone ol. Apple: Dosya → Yeni takvim aboneliği.
              Bağlantı 1 yıl geçerlidir; duruşma, randevu, süre ve görev teslimleri tek yönlü (NomosOS → takvim) akar.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
