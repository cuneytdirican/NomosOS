"use client";

/**
 * Faturalar — Modül 09.
 *
 * GET  /billing/invoices          — liste (durum, müvekkil süzgeci)
 * POST /billing/invoices          — taslak fatura (elle satır VEYA timeEntryIds)
 * GET  /billing/time-entries      — "zaman kayıtlarından fatura" akışının kaynağı
 *
 * PARA İLKESİ — BU SAYFANIN EN ÖNEMLİ KURALI:
 * Ara toplam, KDV ve genel toplam SUNUCUDA hesaplanır. İstemci fatura
 * gövdesinde ASLA `subtotal/vatAmount/total` göndermez; yalnızca satır
 * girdilerini (açıklama, miktar, birim fiyat, KDV oranı) yollar. Formdaki
 * toplam satırı "ÖN İZLEME" etiketiyle gösterilir ve tamsayı kuruş aritmetiğiyle
 * (lib/money) hesaplanır — kaydedildikten sonra ekranda daima SUNUCUNUN
 * döndürdüğü tutarlar görünür.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api, asList } from "@/lib/api";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import {
  DEFAULT_VAT_RATE,
  createInvoice,
  listInvoices,
  listUnbilledTimeEntries,
  type InvoiceLineInput,
} from "@/lib/billing";
import type { Invoice, TimeEntry } from "@/lib/faz3-types";
import type { Client } from "@/lib/types";
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
import { fmtAmount, fmtKurus, previewLineTotal, previewVat } from "@/lib/money";
import {
  E_INVOICE_STATUS_LABELS,
  E_INVOICE_STATUS_TONES,
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  fmtDate,
  fmtMinutes,
  labelOf,
  minutesToHoursLabel,
  toIsoDate,
  addDays,
} from "@/lib/labels";

export default function FaturalarPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInvoices(
        await listInvoices({
          status: status || undefined,
          clientId: clientId || undefined,
          limit: 200,
        }),
      );
      setMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setMissing(true);
        setInvoices([]);
      } else {
        setError(errText(err, "Faturalar yüklenemedi."));
      }
    } finally {
      setLoading(false);
    }
  }, [status, clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<unknown>("/clients", { query: { limit: 200 } })
      .then((p) => setClients(asList<Client>(p)))
      .catch(() => setClients([]));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of invoices) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [invoices]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Faturalar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Taslak faturadan tahsilata. Tutarlar sunucuda hesaplanır; arayüz yalnızca gösterir.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setTimeOpen(true)} disabled={missing}>
            Zaman Kayıtlarından Fatura
          </Button>
          <Button variant="gold" onClick={() => setManualOpen(true)} disabled={missing}>
            + Yeni Fatura
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Toplam Fatura" value={invoices.length} tone="navy" />
        <StatCard label="Taslak" value={counts.TASLAK ?? 0} tone="slate" />
        <StatCard
          label="Kısmi / Bekleyen"
          value={(counts.GONDERILDI ?? 0) + (counts.KISMI_ODENDI ?? 0)}
          tone="gold"
        />
        <StatCard label="Ödendi" value={counts.ODENDI ?? 0} tone="green" />
      </div>

      <Card title="Filtre">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Durum">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tümü</option>
              {INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {labelOf(INVOICE_STATUS_LABELS, s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Müvekkil">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
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

      {missing ? (
        <FeatureUnavailable
          title="Faturalama modülü henüz yayında değil"
          detail="/api/v1/billing/invoices yayına alındığında bu ekran otomatik çalışacak."
          onRetry={() => void load()}
        />
      ) : loading ? (
        <Spinner label="Faturalar yükleniyor…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : invoices.length === 0 ? (
        <EmptyState message="Bu süzgeçle eşleşen fatura yok." />
      ) : (
        <Card title={`${invoices.length} fatura`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Fatura No</th>
                  <th className="py-2 pr-4 font-medium">Müvekkil</th>
                  <th className="py-2 pr-4 font-medium">Düzenleme</th>
                  <th className="py-2 pr-4 font-medium">Vade</th>
                  <th className="py-2 pr-4 text-right font-medium">Ara Toplam</th>
                  <th className="py-2 pr-4 text-right font-medium">KDV</th>
                  <th className="py-2 pr-4 text-right font-medium">Toplam</th>
                  <th className="py-2 pr-4 font-medium">Durum</th>
                  <th className="py-2 font-medium">e-Fatura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => {
                  const cur = inv.currency ?? "TRY";
                  const overdue =
                    inv.dueDate &&
                    inv.status !== "ODENDI" &&
                    inv.status !== "IPTAL" &&
                    new Date(inv.dueDate).getTime() < Date.now();
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-4">
                        <Link
                          href={`/app/faturalar/${inv.id}`}
                          className="font-medium text-slate-900 hover:text-amber-600"
                        >
                          {inv.invoiceNo ?? "Numarasız taslak"}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-slate-700">{inv.client?.name ?? "—"}</td>
                      <td className="py-3 pr-4 text-xs text-slate-500">{fmtDate(inv.issueDate)}</td>
                      <td className="py-3 pr-4 text-xs">
                        <span className={overdue ? "font-medium text-red-600" : "text-slate-500"}>
                          {fmtDate(inv.dueDate)}
                          {overdue ? " · vadesi geçti" : ""}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-700">
                        {fmtAmount(inv.subtotal, cur)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-600">
                        {fmtAmount(inv.vatAmount, cur)}
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold tabular-nums text-slate-900">
                        {fmtAmount(inv.total, cur)}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={INVOICE_STATUS_TONES[inv.status] ?? "gray"}>
                          {labelOf(INVOICE_STATUS_LABELS, inv.status)}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <Badge tone={E_INVOICE_STATUS_TONES[inv.eInvoiceStatus ?? "YOK"] ?? "gray"}>
                          {labelOf(E_INVOICE_STATUS_LABELS, inv.eInvoiceStatus ?? "YOK")}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ManualInvoiceModal
        open={manualOpen}
        clients={clients}
        onClose={() => setManualOpen(false)}
        onCreated={(inv) => {
          setManualOpen(false);
          push("Taslak fatura oluşturuldu. Tutarlar sunucuda hesaplandı.");
          void load();
          router.push(`/app/faturalar/${inv.id}`);
        }}
      />

      <TimeEntryInvoiceModal
        open={timeOpen}
        clients={clients}
        onClose={() => setTimeOpen(false)}
        onCreated={(inv) => {
          setTimeOpen(false);
          push("Zaman kayıtlarından taslak fatura oluşturuldu.");
          void load();
          router.push(`/app/faturalar/${inv.id}`);
        }}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- Elle fatura ----------

interface LineForm {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
}

const EMPTY_LINE: LineForm = {
  description: "",
  quantity: "1",
  unitPrice: "",
  vatRate: DEFAULT_VAT_RATE,
};

function ManualInvoiceModal({
  open,
  clients,
  onClose,
  onCreated,
}: {
  open: boolean;
  clients: Client[];
  onClose: () => void;
  onCreated: (inv: Invoice) => void;
}) {
  const [clientId, setClientId] = useState("");
  const [issueDate, setIssueDate] = useState(toIsoDate(new Date()));
  const [dueDate, setDueDate] = useState(toIsoDate(addDays(new Date(), 30)));
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLines([{ ...EMPTY_LINE }]);
    setNote("");
  }, [open]);

  /**
   * ÖN İZLEME toplamı — tamsayı kuruş aritmetiği (float yok). Bu değer
   * SUNUCUYA GÖNDERİLMEZ; yalnızca kullanıcı satırları girerken ne kadara
   * yaklaştığını görsün diye vardır. Kesin tutar kaydetme yanıtından okunur.
   */
  const preview = useMemo(() => {
    const lineTotals = lines.map((l) => previewLineTotal(l.quantity, l.unitPrice));
    const subtotal = lineTotals.reduce<bigint>((acc, v) => acc + (v ?? 0n), 0n);
    const vat = lines.reduce<bigint>((acc, l, i) => {
      const v = previewVat(lineTotals[i], l.vatRate);
      return acc + (v ?? 0n);
    }, 0n);
    return { lineTotals, subtotal, vat, total: subtotal + vat };
  }, [lines]);

  function setLine(index: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: InvoiceLineInput[] = lines
        .filter((l) => l.description.trim() && l.unitPrice.trim())
        .map((l) => ({
          description: l.description.trim(),
          quantity: l.quantity.trim().replace(",", ".") || "1",
          unitPrice: l.unitPrice.trim().replace(",", "."),
          vatRate: l.vatRate.trim().replace(",", ".") || DEFAULT_VAT_RATE,
          sourceType: "MANUEL",
        }));
      if (payload.length === 0) {
        setError("En az bir fatura satırı girin (açıklama ve birim fiyat zorunlu).");
        setSaving(false);
        return;
      }
      // DİKKAT: gövdede subtotal/vatAmount/total YOKTUR — sunucu hesaplar.
      const inv = await createInvoice({
        clientId,
        issueDate,
        dueDate: dueDate || undefined,
        note: note.trim() || undefined,
        lines: payload,
      });
      onCreated(inv);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Fatura oluşturulamadı.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Yeni Fatura (Taslak)" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Müvekkil">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
              <option value="">Seçiniz…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Düzenleme tarihi">
            <Input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Vade">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Satırlar
          </p>
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <Field label="Açıklama">
                      <Input
                        value={l.description}
                        onChange={(e) => setLine(i, { description: e.target.value })}
                        placeholder="Danışmanlık ücreti (Ağustos)"
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Miktar">
                      <Input
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) => setLine(i, { quantity: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Birim fiyat">
                      <Input
                        inputMode="decimal"
                        value={l.unitPrice}
                        onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="KDV %">
                      <Input
                        inputMode="decimal"
                        value={l.vatRate}
                        onChange={(e) => setLine(i, { vatRate: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="flex items-end sm:col-span-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLines((prev) => prev.filter((_, x) => x !== i))}
                      disabled={lines.length === 1}
                      aria-label="Satırı sil"
                    >
                      Sil
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-right text-[11px] text-slate-500">
                  Satır ön izleme:{" "}
                  <span className="font-medium tabular-nums">
                    {fmtKurus(preview.lineTotals[i], "TRY")}
                  </span>
                </p>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
          >
            + Satır Ekle
          </Button>
        </div>

        <Field label="Fatura notu">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {/* ÖN İZLEME kutusu — kesin tutar değildir, açıkça belirtilir. */}
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Ön izleme — kesin tutarı sunucu hesaplar
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Ara toplam</dt>
              <dd className="font-medium tabular-nums text-slate-900">
                {fmtKurus(preview.subtotal, "TRY")}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">KDV</dt>
              <dd className="font-medium tabular-nums text-slate-900">
                {fmtKurus(preview.vat, "TRY")}
              </dd>
            </div>
            <div className="flex justify-between border-t border-amber-200 pt-1">
              <dt className="font-semibold text-slate-800">Genel toplam</dt>
              <dd className="font-bold tabular-nums text-slate-900">
                {fmtKurus(preview.total, "TRY")}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] leading-4 text-amber-800">
            Bu rakamlar tamsayı kuruş aritmetiğiyle hesaplanmış tahmindir. Kaydettikten sonra
            faturada sunucunun hesapladığı tutarlar görünür; ikisi arasında fark olursa geçerli
            olan sunucudur.
          </p>
        </div>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={saving || !clientId}>
            {saving ? "Oluşturuluyor…" : "Taslağı Oluştur"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Zaman kayıtlarından fatura ----------

function TimeEntryInvoiceModal({
  open,
  clients,
  onClose,
  onCreated,
}: {
  open: boolean;
  clients: Client[];
  onClose: () => void;
  onCreated: (inv: Invoice) => void;
}) {
  const [clientId, setClientId] = useState("");
  const [dateFrom, setDateFrom] = useState(toIsoDate(addDays(new Date(), -30)));
  const [dateTo, setDateTo] = useState(toIsoDate(new Date()));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState(toIsoDate(new Date()));

  useEffect(() => {
    if (!open) return;
    setEntries([]);
    setSelected({});
    setSearched(false);
    setError(null);
  }, [open]);

  async function search() {
    if (!clientId) return;
    setSearching(true);
    setError(null);
    try {
      const list = await listUnbilledTimeEntries({ clientId, dateFrom, dateTo, limit: 300 });
      setEntries(list);
      setSelected(Object.fromEntries(list.map((t) => [t.id, true])));
      setSearched(true);
    } catch (err) {
      setError(errText(err, "Zaman kayıtları alınamadı."));
    } finally {
      setSearching(false);
    }
  }

  const chosen = entries.filter((t) => selected[t.id]);
  const totalMinutes = chosen.reduce((acc, t) => acc + (t.minutes ?? 0), 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (chosen.length === 0) {
      setError("En az bir zaman kaydı seçin.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Satırları ve tutarları SUNUCU üretir: seçilen kayıtların id'lerini
      // gönderiyoruz, saat × tarife hesabını istemci YAPMIYOR.
      const inv = await createInvoice({
        clientId,
        issueDate,
        timeEntryIds: chosen.map((t) => t.id),
      });
      onCreated(inv);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Fatura oluşturulamadı.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Zaman Kayıtlarından Fatura" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Müvekkil">
            <Select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setSearched(false);
                setEntries([]);
              }}
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
          <Field label="Başlangıç">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => void search()} disabled={!clientId || searching}>
              {searching ? "Aranıyor…" : "Kayıtları Listele"}
            </Button>
          </div>
        </div>

        {searched && entries.length === 0 && (
          <EmptyState message="Seçilen aralıkta faturalanmamış, faturalanabilir zaman kaydı bulunamadı." />
        )}

        {entries.length > 0 && (
          <div className="rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
              <span className="text-xs font-medium text-slate-600">
                {chosen.length} / {entries.length} kayıt seçili · toplam{" "}
                {fmtMinutes(totalMinutes)} ({minutesToHoursLabel(totalMinutes)} sa)
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelected(Object.fromEntries(entries.map((t) => [t.id, true])))
                  }
                >
                  Tümünü seç
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected({})}>
                  Temizle
                </Button>
              </div>
            </div>
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {entries.map((t) => (
                <li key={t.id} className="flex items-start gap-3 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[t.id])}
                    onChange={(e) => setSelected({ ...selected, [t.id]: e.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    aria-label={`${t.description} kaydını seç`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{t.description}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {fmtDate(t.date)} · {fmtMinutes(t.minutes)}
                      {t.case ? ` · ${t.case.fileNumber ?? t.case.title}` : ""}
                      {t.user?.fullName ? ` · ${t.user.fullName}` : ""}
                    </p>
                  </div>
                  {t.hourlyRate !== undefined && t.hourlyRate !== null && (
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {fmtAmount(t.hourlyRate)}/sa
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field label="Fatura düzenleme tarihi">
          <Input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
          />
        </Field>

        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
          Satır açıklamaları, saat karşılıkları ve tutarlar SUNUCUDA üretilir. Buradan yalnızca
          seçilen kayıtların kimlikleri gönderilir; saat × tarife hesabı arayüzde yapılmaz.
          Faturaya giren kayıtlar kilitlenir ve ikinci kez faturalanamaz.
        </p>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={saving || chosen.length === 0}>
            {saving ? "Oluşturuluyor…" : `${chosen.length} kayıttan taslak oluştur`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
