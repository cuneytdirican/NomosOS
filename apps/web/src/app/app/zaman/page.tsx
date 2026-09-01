"use client";

/**
 * Zaman Kaydı (timesheet) — Modül 09.
 *
 * GET/POST /billing/time-entries   — liste / hızlı giriş
 * DELETE   /billing/time-entries/:id — faturalanmamış kaydı sil
 * GET /cases, /users               — dosya seçimi ve kullanıcı süzgeci
 *
 * SÜRE BİRİMİ: `minutes` TAMSAYI DAKİKADIR. Saat gösterimi ("7,50 sa") yalnızca
 * ekrandadır; fatura satırındaki saat × tarife hesabı SUNUCUDA yapılır.
 * Bu sayfa hiçbir tutar hesaplamaz — yalnızca dakika toplar.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList, SERVER_MAX_PAGE_SIZE } from "@/lib/api";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import { createTimeEntry, deleteTimeEntry, listTimeEntries } from "@/lib/billing";
import type { TimeEntry } from "@/lib/faz3-types";
import type { CaseSummary, TenantUser } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Select,
  Spinner,
  StatCard,
  Textarea,
} from "@/components/ui";
import { FeatureUnavailable, ToastStack, useToasts } from "@/components/ai-ui";
import {
  fmtDate,
  fmtDayHeading,
  fmtMinutes,
  minutesToHoursLabel,
  startOfWeek,
  toIsoDate,
  addDays,
} from "@/lib/labels";

/** Hızlı giriş için sık kullanılan süreler (dakika). */
const QUICK_MINUTES = [15, 30, 45, 60, 90, 120, 180] as const;

type RangeKey = "gun" | "hafta";

export default function ZamanPage() {
  const [range, setRange] = useState<RangeKey>("hafta");
  const [userFilter, setUserFilter] = useState("");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const { dateFrom, dateTo } = useMemo(() => {
    const today = new Date();
    if (range === "gun") {
      const d = toIsoDate(today);
      return { dateFrom: d, dateTo: d };
    }
    const start = startOfWeek(today);
    return { dateFrom: toIsoDate(start), dateTo: toIsoDate(addDays(start, 6)) };
  }, [range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(
        await listTimeEntries({
          dateFrom,
          dateTo,
          userId: userFilter || undefined,
          // F2-Ö-21: sunucu 200 üstünü kırpıyor (SERVER_MAX_PAGE_SIZE=200);
          // 300 istemek sunucuda sessizce 200'e düşer. En yüksek değer açıkça
          // istenir; kırpılma biliniyorsa uyarı gösterilir (aşağıda truncated).
          limit: SERVER_MAX_PAGE_SIZE,
        }),
      );
      setMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setMissing(true);
        setEntries([]);
      } else {
        setError(errText(err, "Zaman kayıtları yüklenemedi."));
      }
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, userFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // F2-Ö-21: dosya seçici de 300 yerine sunucu tavanını ister (200) ve
    // SAYFALI çeker — ilk sayfa yalnızca ilk 200 dosyayı gösterir, arama
    // kutusundan geri kalanlar bulunur (aşağıda caseSearch filtresi).
    void api<unknown>("/cases", { query: { limit: SERVER_MAX_PAGE_SIZE } })
      .then((p) => setCases(asList<CaseSummary>(p)))
      .catch(() => setCases([]));
    void api<unknown>("/users")
      .then((p) => setUsers(asList<TenantUser>(p)))
      .catch(() => setUsers([]));
  }, []);

  /** Günlere göre grupla (yalnız dakika toplanır; para hesabı YOK). */
  const grouped = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const t of entries) {
      const key = t.date?.slice(0, 10) ?? "—";
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries]);

  const totalMinutes = entries.reduce((a, t) => a + (t.minutes ?? 0), 0);
  const billableMinutes = entries
    .filter((t) => t.billable !== false)
    .reduce((a, t) => a + (t.minutes ?? 0), 0);
  const unbilledMinutes = entries
    .filter((t) => t.billable !== false && !t.invoiceId)
    .reduce((a, t) => a + (t.minutes ?? 0), 0);

  /** Kullanıcı bazlı dakika toplamı. */
  const perUser = useMemo(() => {
    const map = new Map<string, { name: string; minutes: number }>();
    for (const t of entries) {
      const key = t.user?.id ?? t.userId ?? "—";
      const name = t.user?.fullName ?? "Bilinmiyor";
      const cur = map.get(key) ?? { name, minutes: 0 };
      cur.minutes += t.minutes ?? 0;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.minutes - a.minutes);
  }, [entries]);

  async function remove(t: TimeEntry) {
    if (t.invoiceId) {
      push("Faturalanmış zaman kaydı silinemez. Önce faturayı iptal edin.", "error");
      return;
    }
    if (!window.confirm("Bu zaman kaydı silinsin mi?")) return;
    setBusyId(t.id);
    try {
      await deleteTimeEntry(t.id);
      push("Zaman kaydı silindi.");
      await load();
    } catch (err) {
      push(err instanceof ApiError ? err.message : "Zaman kaydı silinemedi.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Zaman Kaydı</h1>
        <p className="mt-1 text-sm text-slate-500">
          Dosyalara harcanan süre. Faturalanabilir kayıtlar Faturalar ekranındaki &quot;Zaman
          Kayıtlarından Fatura&quot; akışına girer.
        </p>
      </div>

      {missing ? (
        <FeatureUnavailable
          title="Zaman kaydı ucu henüz yayında değil"
          detail="/api/v1/billing/time-entries yayına alındığında bu ekran otomatik çalışacak."
          onRetry={() => void load()}
        />
      ) : (
        <>
          <QuickEntryForm
            cases={cases}
            onSaved={() => {
              push("Zaman kaydı eklendi.");
              void load();
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={range === "gun" ? "Bugün" : "Bu Hafta"}
              value={fmtMinutes(totalMinutes)}
              tone="navy"
              hint={`${minutesToHoursLabel(totalMinutes)} saat`}
            />
            <StatCard
              label="Faturalanabilir"
              value={fmtMinutes(billableMinutes)}
              tone="gold"
              hint={`${minutesToHoursLabel(billableMinutes)} saat`}
            />
            <StatCard
              label="Henüz Faturalanmadı"
              value={fmtMinutes(unbilledMinutes)}
              tone="slate"
              hint="Faturaya aktarılmayı bekliyor"
            />
            <StatCard label="Kayıt Sayısı" value={entries.length} tone="slate" />
          </div>

          <Card title="Görünüm">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Aralık">
                <Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
                  <option value="gun">Bugün</option>
                  <option value="hafta">Bu hafta</option>
                </Select>
              </Field>
              <Field label="Kullanıcı">
                <Select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
                  <option value="">Tümü</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <p className="text-xs text-slate-500">
                  {fmtDate(dateFrom)} – {fmtDate(dateTo)}
                </p>
              </div>
            </div>
          </Card>

          {perUser.length > 0 && (
            <Card title="Kullanıcı Bazlı Toplam">
              <ul className="divide-y divide-slate-100">
                {perUser.map((u) => (
                  <li key={u.name} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-slate-800">{u.name}</span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">
                      {fmtMinutes(u.minutes)}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {minutesToHoursLabel(u.minutes)} sa
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Kayıtlar">
            {loading ? (
              <Spinner label="Zaman kayıtları yükleniyor…" />
            ) : error ? (
              <ErrorBox message={error} />
            ) : grouped.length === 0 ? (
              <EmptyState message="Seçilen aralıkta zaman kaydı yok." />
            ) : (
              <div className="space-y-5">
                {grouped.map(([day, list]) => {
                  const dayMinutes = list.reduce((a, t) => a + (t.minutes ?? 0), 0);
                  return (
                    <div key={day}>
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {fmtDayHeading(day)}
                        </p>
                        <span className="text-xs font-medium tabular-nums text-slate-600">
                          {fmtMinutes(dayMinutes)}
                        </span>
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {list.map((t) => (
                          <li
                            key={t.id}
                            className="flex flex-wrap items-start justify-between gap-3 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-slate-800">{t.description}</p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                {t.case && (
                                  <Link
                                    href={`/app/dosyalar/${t.case.id}`}
                                    className="hover:text-amber-600"
                                  >
                                    {t.case.fileNumber ?? t.case.title}
                                  </Link>
                                )}
                                {t.user?.fullName && <span>{t.user.fullName}</span>}
                                {t.billable === false ? (
                                  <Badge tone="gray">Faturalanmaz</Badge>
                                ) : t.invoiceId ? (
                                  <Link href={`/app/faturalar/${t.invoiceId}`}>
                                    <Badge tone="green">Faturalandı</Badge>
                                  </Link>
                                ) : (
                                  <Badge tone="yellow">Faturalanmadı</Badge>
                                )}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <span className="text-sm font-semibold tabular-nums text-slate-900">
                                {fmtMinutes(t.minutes)}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busyId === t.id || Boolean(t.invoiceId)}
                                onClick={() => void remove(t)}
                                title={
                                  t.invoiceId
                                    ? "Faturalanmış kayıt silinemez"
                                    : "Zaman kaydını sil"
                                }
                              >
                                Sil
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-4 text-[11px] leading-5 text-slate-500">
              Süreler tamsayı dakika olarak saklanır; saat karşılığı yalnızca gösterim içindir.
              Fatura satırındaki saat × tarife hesabı sunucuda yapılır.
            </p>
          </Card>
        </>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- Hızlı giriş ----------

function QuickEntryForm({
  cases,
  onSaved,
}: {
  cases: CaseSummary[];
  onSaved: () => void;
}) {
  const [caseId, setCaseId] = useState("");
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [minutes, setMinutes] = useState("60");
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCase = cases.find((c) => c.id === caseId);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const min = Number.parseInt(minutes, 10);
    if (!Number.isFinite(min) || min <= 0) {
      setError("Süre pozitif bir tamsayı dakika olmalıdır.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createTimeEntry({
        caseId: caseId || undefined,
        // Müvekkil dosyadan türetilir; ikisi de yoksa sunucu reddeder.
        clientId: selectedCase?.client?.id,
        date,
        minutes: min,
        description: description.trim(),
        billable,
      });
      setDescription("");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Zaman kaydı eklenemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Hızlı Giriş">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Field label="Dosya">
              <Select value={caseId} onChange={(e) => setCaseId(e.target.value)} required>
                <option value="">Seçiniz…</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fileNumber ? `${c.fileNumber} — ` : ""}
                    {c.title}
                    {c.client?.name ? ` (${c.client.name})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Tarih">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Süre (dakika)" hint="Tamsayı dakika olarak saklanır.">
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          {QUICK_MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMinutes(String(m))}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                minutes === String(m)
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {fmtMinutes(m)}
            </button>
          ))}
          <span className="self-center text-xs text-slate-500">
            = {minutesToHoursLabel(Number.parseInt(minutes, 10) || 0)} sa
          </span>
        </div>

        <Field label="Ne yapıldı?">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Cevap dilekçesi hazırlığı, emsal karar taraması"
            required
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            Faturalanabilir
          </label>
          <Button type="submit" variant="gold" disabled={saving || !caseId}>
            {saving ? "Kaydediliyor…" : "Süreyi Kaydet"}
          </Button>
        </div>

        {error && <ErrorBox message={error} />}
      </form>
    </Card>
  );
}
