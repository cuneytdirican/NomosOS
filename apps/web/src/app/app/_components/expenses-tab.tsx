"use client";

/**
 * DOSYA GİDERLERİ SEKMESİ (D2 A1) — dosyanın gerçek maliyeti.
 *
 * GET  /cases/:caseId/case-expenses          — liste + özet
 * GET  /cases/:caseId/case-expenses/closing   — İİK m.202 kapatma hesabı
 * POST /cases/:caseId/case-expenses          — gider ekle
 * POST /case-expenses/:id/mark-paid           — ödeme işaretle
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Spinner } from "@/components/ui";

interface ExpenseRow {
  id: string;
  category: string;
  title: string;
  amount: string;
  currency: string;
  spentAt: string;
  paidAt: string | null;
  paidFrom: string;
  refundable: boolean;
  note: string | null;
}

interface Summary {
  count: number;
  total: string;
  paid: string;
  unpaid: string;
}

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "HARC", label: "Harç" },
  { value: "BILIRKISI", label: "Bilirkişi" },
  { value: "TEBLIGAT", label: "Tebligat" },
  { value: "YOL_DANISMA", label: "Yol / Danışma" },
  { value: "DIGER", label: "Diğer" },
];

function categoryLabel(c: string): string {
  return CATEGORIES.find((x) => x.value === c)?.label ?? c;
}

function fmtTL(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

export function ExpensesTab({ caseId }: { caseId: string }) {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ refundableTotal: string; refundableCount: number } | null>(null);

  const [form, setForm] = useState({ category: "HARC", title: "", amount: "", spentAt: "", refundable: true });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ expenses: ExpenseRow[]; summary: Summary }>(
        `/cases/${caseId}/case-expenses`,
      );
      setExpenses(res.expenses ?? []);
      setSummary(res.summary ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Giderler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadClosing() {
    try {
      const res = await api<{ refundableTotal: string; refundableCount: number }>(
        `/cases/${caseId}/case-expenses/closing`,
      );
      setClosing(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kapatma hesabı alınamadı.");
    }
  }

  async function addExpense() {
    setBusy(true);
    setFormError(null);
    try {
      await api(`/cases/${caseId}/case-expenses`, {
        method: "POST",
        body: {
          category: form.category,
          title: form.title.trim(),
          amount: Number(form.amount.replace(",", ".")),
          spentAt: form.spentAt,
          refundable: form.refundable,
        },
      });
      setForm({ category: "HARC", title: "", amount: "", spentAt: "", refundable: true });
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Gider eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(id: string) {
    try {
      await api(`/case-expenses/${id}/mark-paid`, { method: "POST", body: { paidFrom: "AVANS" } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İşaretleme başarısız.");
    }
  }

  return (
    <div className="space-y-4">
      {/* Özet kartları */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <div className="p-4">
              <p className="text-xs text-slate-500">Toplam gider</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{fmtTL(summary.total)}</p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-xs text-slate-500">Ödenmiş</p>
              <p className="mt-1 text-lg font-bold text-emerald-700">{fmtTL(summary.paid)}</p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-xs text-slate-500">Ödenmemiş</p>
              <p className="mt-1 text-lg font-bold text-amber-700">{fmtTL(summary.unpaid)}</p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-xs text-slate-500">Kayıt</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{summary.count} kalem</p>
            </div>
          </Card>
        </div>
      )}

      {error && <ErrorBox message={error} />}

      {/* Yeni gider formu */}
      <Card>
        <p className="p-4 pb-0 text-sm font-semibold text-slate-700">Gider ekle</p>
        <div className="grid gap-3 p-4 sm:grid-cols-5">
          <Field label="Tür">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlık">
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Peşin harç"
            />
          </Field>
          <Field label="Tutar (TL)">
            <Input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="6831.00"
              inputMode="decimal"
            />
          </Field>
          <Field label="Tarih">
            <Input
              type="date"
              value={form.spentAt}
              onChange={(e) => setForm({ ...form, spentAt: e.target.value })}
            />
          </Field>
          <div className="flex flex-col justify-end gap-1">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={form.refundable}
                onChange={(e) => setForm({ ...form, refundable: e.target.checked })}
                className="h-4 w-4 accent-amber-600"
              />
              İİK m.202 iadesi
            </label>
            <Button
              disabled={busy || !form.title.trim() || !form.amount || !form.spentAt}
              onClick={() => void addExpense()}
            >
              {busy ? "Ekleniyor…" : "Ekle"}
            </Button>
          </div>
        </div>
        {formError && <p className="px-4 pb-3 text-xs text-red-700">{formError}</p>}
      </Card>

      {/* Liste */}
      <Card>
        {loading ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : expenses.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Bu dosyada gider kaydı yok." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 font-medium">Tarih</th>
                  <th className="px-4 py-2 font-medium">Tür</th>
                  <th className="px-4 py-2 font-medium">Başlık</th>
                  <th className="px-4 py-2 text-right font-medium">Tutar</th>
                  <th className="px-4 py-2 font-medium">Ödeme</th>
                  <th className="px-4 py-2 font-medium">İade</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {new Date(e.spentAt).toLocaleDateString("tr-TR")}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone="navy">{categoryLabel(e.category)}</Badge>
                    </td>
                    <td className="px-4 py-2 text-slate-800">{e.title}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {fmtTL(e.amount)}
                    </td>
                    <td className="px-4 py-2">
                      {e.paidAt ? (
                        <Badge tone="green">Ödendi ({e.paidFrom === "BURO" ? "büro" : "avans"})</Badge>
                      ) : (
                        <Button variant="secondary" onClick={() => void markPaid(e.id)}>
                          Ödendi işaretle
                        </Button>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {e.refundable ? <Badge tone="blue">m.202</Badge> : <span className="text-xs text-slate-500">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{e.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* İİK m.202 kapatma hesabı */}
      <Card>
        <div className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-semibold text-slate-700">Dosya kapatma hesabı (İİK m.202)</p>
            <p className="text-xs text-slate-500">
              Gider avansından karşılanan ve müvekkile iade edilebilir kalemlerin özeti.
            </p>
          </div>
          <Button variant="secondary" onClick={() => void loadClosing()}>
            Hesapla
          </Button>
        </div>
        {closing && (
          <div className="border-t border-slate-100 p-4 text-sm">
            <p>
              İade edilebilir kalem: <strong>{closing.refundableCount}</strong> · Toplam:{" "}
              <strong className="text-emerald-700">{fmtTL(closing.refundableTotal)}</strong>
            </p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">
              İİK m.202: tahsil edilen gider avansının kullanılmayan kısmı, geri verilmesi istenildiği anda iade edilir.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
