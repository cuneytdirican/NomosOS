"use client";

/**
 * Büro Finans Panosu — Modül 08.
 *
 * GET  /finance/reports/office   — dönem KPI'ları, yaşlandırma, en borçlu müvekkiller
 * GET  /finance/reports/aging    — (rapor gövdesinde yoksa) yaşlandırma
 * GET/POST /finance/entries      — hareket listesi / hareket ekleme
 * GET  /clients, /cases          — form ve süzgeç seçimleri
 *
 * PARA İLKESİ: bu sayfada HİÇBİR TOPLAM HESAPLANMAZ. Tahakkuk, tahsilat, toplam
 * alacak, yaşlandırma kovaları ve müvekkil bakiyeleri sunucudan gelir. Yalnızca
 * yaşlandırma çubuklarının GENİŞLİĞİ istemcide oransal olarak çizilir; bu görsel
 * bir orandır, gösterilen tutar daima sunucunun gönderdiği değerdir.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList } from "@/lib/api";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import { createFinanceEntry, getOfficeReport, listFinanceEntries } from "@/lib/finance";
import type { FinanceEntry, OfficeFinanceReport } from "@/lib/faz3-types";
import type { CaseSummary, Client } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  StatCard,
  Textarea,
} from "@/components/ui";
import { FeatureUnavailable, ToastStack, useToasts } from "@/components/ai-ui";
import { fmtAmount, sharePercent, sumKurus, toKurus } from "@/lib/money";
import {
  AGING_BUCKET_LABELS,
  AGING_BUCKET_TONES,
  COLLECTION_RISK_LABELS,
  COLLECTION_RISK_TONES,
  FINANCIAL_ENTRY_TYPE_LABELS,
  FINANCIAL_ENTRY_TYPE_TONES,
  fmtDate,
  labelOf,
  toIsoDate,
} from "@/lib/labels";
import { FINANCIAL_ENTRY_TYPES } from "@nomosos/shared";

/** Ay başı / bugün — dönem süzgecinin varsayılanı. */
function monthStart(): string {
  const d = new Date();
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

export default function FinansPage() {
  const [report, setReport] = useState<OfficeFinanceReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportMissing, setReportMissing] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(toIsoDate(new Date()));

  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [entriesMissing, setEntriesMissing] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");

  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      setReport(await getOfficeReport({ dateFrom, dateTo }));
      setReportMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setReportMissing(true);
        setReport(null);
      } else {
        setReportError(errText(err, "Büro finans raporu alınamadı."));
      }
    } finally {
      setReportLoading(false);
    }
  }, [dateFrom, dateTo]);

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      setEntries(
        await listFinanceEntries({
          type: typeFilter || undefined,
          clientId: clientFilter || undefined,
          dateFrom,
          dateTo,
          limit: 200,
        }),
      );
      setEntriesMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setEntriesMissing(true);
        setEntries([]);
      } else {
        setEntriesError(errText(err, "Finans hareketleri yüklenemedi."));
      }
    } finally {
      setEntriesLoading(false);
    }
  }, [typeFilter, clientFilter, dateFrom, dateTo]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    void api<unknown>("/clients", { query: { limit: 200 } })
      .then((p) => setClients(asList<Client>(p)))
      .catch(() => setClients([]));
  }, []);

  const currency = report?.currency ?? "TRY";
  const aging = report?.aging ?? [];
  const topDebtors = report?.topDebtors ?? [];

  /** Yaşlandırma çubuğu ORANI — yalnız görselleştirme (tutar sunucudan). */
  const agingTotal = useMemo(() => sumKurus(aging.map((b) => b.amount)), [aging]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Finans</h1>
          <p className="mt-1 text-sm text-slate-500">
            Büro geneli tahakkuk, tahsilat ve alacak yaşlandırması. Tüm tutarlar sunucudaki
            deterministik hesaptan gelir.
          </p>
        </div>
        <Button variant="gold" onClick={() => setOpen(true)} disabled={entriesMissing}>
          + Finans Hareketi
        </Button>
      </div>

      <Card title="Dönem">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Başlangıç">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
          <Field label="Hareket tipi">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">Tümü</option>
              {FINANCIAL_ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(FINANCIAL_ENTRY_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Müvekkil">
            <Select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="">Tümü</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {reportMissing ? (
        <FeatureUnavailable
          title="Finans raporu ucu henüz yayında değil"
          detail="/api/v1/finance/reports/office yayına alındığında bu kartlar dolacak."
          onRetry={() => void loadReport()}
        />
      ) : reportLoading ? (
        <Spinner label="Büro finans özeti hesaplanıyor…" />
      ) : reportError ? (
        <ErrorBox message={reportError} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Dönem Tahakkuku"
              value={fmtAmount(report?.monthAccrued, currency)}
              tone="navy"
              hint="Seçilen dönemde müvekkile yansıtılan alacak"
            />
            <StatCard
              label="Dönem Tahsilatı"
              value={fmtAmount(report?.monthCollected, currency)}
              tone="green"
              hint="Fiilen alınan ödeme"
            />
            <StatCard
              label="Toplam Alacak"
              value={fmtAmount(report?.totalReceivable ?? report?.totalOutstanding, currency)}
              tone="gold"
              hint="Bekleyen bakiye (dönemden bağımsız)"
            />
            <StatCard
              label="Avans Bakiyesi"
              value={fmtAmount(report?.advanceBalance, currency)}
              tone="slate"
              hint="Müvekkillerden alınmış, mahsup edilmemiş tutar"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Alacak Yaşlandırması">
              {aging.length === 0 ? (
                <EmptyState message="Yaşlandırma verisi dönmedi." />
              ) : (
                <div className="space-y-3">
                  {aging.map((b, i) => {
                    const key = b.range ?? b.key ?? b.label ?? String(i);
                    const share = sharePercent(toKurus(b.amount), agingTotal);
                    const tone = AGING_BUCKET_TONES[key] ?? "gray";
                    const bar =
                      tone === "green"
                        ? "bg-emerald-500"
                        : tone === "yellow"
                          ? "bg-amber-500"
                          : tone === "red"
                            ? "bg-red-500"
                            : tone === "danger"
                              ? "bg-red-700"
                              : "bg-slate-400";
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-slate-700">
                            {b.label ?? labelOf(AGING_BUCKET_LABELS, key)}
                            {typeof b.count === "number" && (
                              <span className="ml-2 text-xs text-slate-400">
                                {b.count} kayıt
                              </span>
                            )}
                          </span>
                          <span className="text-sm font-semibold tabular-nums text-slate-900">
                            {fmtAmount(b.amount, currency)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${bar}`} style={{ width: `${share}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  <p className="pt-2 text-[11px] leading-5 text-slate-400">
                    Kova tutarları sunucudan gelir; çubuk genişlikleri yalnızca görsel orandır.
                    90 günü aşan alacaklar tahsilat riskini yükseltir.
                  </p>
                </div>
              )}
            </Card>

            <Card title="En Çok Borcu Olan Müvekkiller">
              {topDebtors.length === 0 ? (
                <EmptyState message="Bekleyen bakiyesi olan müvekkil listesi dönmedi." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {topDebtors.map((d) => (
                    <li
                      key={d.clientId}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
                    >
                      <div>
                        <Link
                          href={`/app/muvekkiller/${d.clientId}`}
                          className="text-sm font-medium text-slate-900 hover:text-amber-600"
                        >
                          {d.clientName ?? d.name ?? "—"}
                        </Link>
                        {typeof d.overdueDays === "number" && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            Ortalama gecikme: {d.overdueDays} gün
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {d.collectionRisk && (
                          <Badge tone={COLLECTION_RISK_TONES[d.collectionRisk] ?? "gray"}>
                            {labelOf(COLLECTION_RISK_LABELS, d.collectionRisk)}
                          </Badge>
                        )}
                        <span className="text-sm font-semibold tabular-nums text-slate-900">
                          {fmtAmount(d.outstanding, d.currency ?? currency)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <Card title="Finans Hareketleri">
        {entriesMissing ? (
          <FeatureUnavailable
            title="Finans hareketleri ucu henüz yayında değil"
            detail="/api/v1/finance/entries yayına alındığında bu liste dolacak."
            onRetry={() => void loadEntries()}
          />
        ) : entriesLoading ? (
          <Spinner label="Hareketler yükleniyor…" />
        ) : entriesError ? (
          <ErrorBox message={entriesError} />
        ) : entries.length === 0 ? (
          <EmptyState message="Seçilen süzgeçle eşleşen finans hareketi yok." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Tarih</th>
                  <th className="py-2 pr-4 font-medium">Tip</th>
                  <th className="py-2 pr-4 font-medium">Müvekkil</th>
                  <th className="py-2 pr-4 font-medium">Dosya</th>
                  <th className="py-2 pr-4 font-medium">Açıklama</th>
                  <th className="py-2 pr-4 text-right font-medium">Tutar</th>
                  <th className="py-2 font-medium">Fatura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4 text-xs text-slate-500">{fmtDate(e.date)}</td>
                    <td className="py-3 pr-4">
                      <Badge tone={FINANCIAL_ENTRY_TYPE_TONES[e.type] ?? "gray"}>
                        {labelOf(FINANCIAL_ENTRY_TYPE_LABELS, e.type)}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">
                      {e.client ? (
                        <Link
                          href={`/app/muvekkiller/${e.client.id}`}
                          className="hover:text-amber-600"
                        >
                          {e.client.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-500">
                      {e.case ? (
                        <Link href={`/app/dosyalar/${e.case.id}`} className="hover:text-amber-600">
                          {e.case.fileNumber ?? e.case.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{e.description ?? "—"}</td>
                    <td className="py-3 pr-4 text-right font-medium tabular-nums text-slate-900">
                      {fmtAmount(e.amount, e.currency ?? currency)}
                    </td>
                    <td className="py-3">
                      {e.invoiceId ? (
                        <Link
                          href={`/app/faturalar/${e.invoiceId}`}
                          className="text-xs text-amber-600 hover:text-amber-500"
                        >
                          Faturaya işlendi →
                        </Link>
                      ) : e.isBillable === false ? (
                        <span className="text-xs text-slate-400">Yansıtılmaz</span>
                      ) : (
                        <span className="text-xs text-slate-400">Faturalanmadı</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewEntryModal
        open={open}
        clients={clients}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          push("Finans hareketi kaydedildi.");
          void loadEntries();
          void loadReport();
        }}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- Hareket girişi ----------

function NewEntryModal({
  open,
  clients,
  onClose,
  onCreated,
}: {
  open: boolean;
  clients: Client[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [form, setForm] = useState({
    clientId: "",
    caseId: "",
    type: "TAHAKKUK",
    amount: "",
    date: toIsoDate(new Date()),
    description: "",
    isBillable: true,
    vatRate: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm((f) => ({ ...f, amount: "", description: "" }));
  }, [open]);

  useEffect(() => {
    if (!open || !form.clientId) {
      setCases([]);
      return;
    }
    void api<unknown>("/cases", { query: { clientId: form.clientId, limit: 200 } })
      .then((p) => setCases(asList<CaseSummary>(p)))
      .catch(() => setCases([]));
  }, [open, form.clientId]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createFinanceEntry({
        clientId: form.clientId,
        caseId: form.caseId || undefined,
        type: form.type as FinanceEntry["type"],
        amount: form.amount.trim().replace(",", "."),
        date: form.date,
        description: form.description.trim() || undefined,
        isBillable: form.isBillable,
        vatRate: form.vatRate.trim() ? form.vatRate.trim().replace(",", ".") : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Finans hareketi kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Yeni Finans Hareketi" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Müvekkil" hint="Her hareket bir müvekkile bağlanmak zorundadır.">
            <Select
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value, caseId: "" })}
              required
            >
              <option value="">Seçiniz…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dosya (isteğe bağlı)">
            <Select
              value={form.caseId}
              onChange={(e) => setForm({ ...form, caseId: e.target.value })}
              disabled={!form.clientId}
            >
              <option value="">Dosyaya bağlı değil</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fileNumber ? `${c.fileNumber} — ` : ""}
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Hareket tipi">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {FINANCIAL_ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(FINANCIAL_ENTRY_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tutar (₺)">
            <Input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </Field>
          <Field label="Tarih">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </Field>
        </div>

        <Field label="Açıklama">
          <Textarea
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="KDV oranı (%)"
            hint="Boş bırakılırsa oran fatura satırında belirlenir. Oran koda gömülü değildir."
          >
            <Input
              inputMode="decimal"
              value={form.vatRate}
              onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
              placeholder="20"
            />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isBillable}
              onChange={(e) => setForm({ ...form, isBillable: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            Müvekkile yansıtılabilir (faturalanabilir)
          </label>
        </div>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
