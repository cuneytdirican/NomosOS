"use client";

/**
 * MEVZUAT KÜTÜPHANESİ (D3 A4) — büronun kendi yüklediği kanun/yönetmelik
 * metinleri + tam metin arama.
 *
 * DÜRÜSTLÜK: Resmî Gazete'den otomatik senkron YOKTUR. Metni büro yükler;
 * güncel tutmak büronun sorumluluğudur. Tam metin değişince sürüm notu
 * zorunludur — "hangi hâli yürürlükte" sorusu görünür kalır.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, Spinner, Textarea } from "@/components/ui";

interface LegislationRow {
  id: string;
  docType: string;
  title: string;
  number: string | null;
  year: number | null;
  tags: string | null;
  versionNote: string | null;
  preview: string;
  updatedAt: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  KANUN: "Kanun",
  KHK: "KHK",
  YONETMELIK: "Yönetmelik",
  TEBLIG: "Tebliğ",
  GENELGE: "Genelge",
  DIGER: "Diğer",
};

const DOC_TYPE_TONES: Record<string, "navy" | "blue" | "gray" | "green" | "yellow"> = {
  KANUN: "navy",
  KHK: "navy",
  YONETMELIK: "blue",
  TEBLIG: "blue",
  GENELGE: "gray",
  DIGER: "gray",
};

export default function MevzuatPage() {
  const [rows, setRows] = useState<LegislationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [docType, setDocType] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    docType: "KANUN",
    title: "",
    number: "",
    year: "",
    tags: "",
    versionNote: "",
    fullText: "",
  });

  const [viewRow, setViewRow] = useState<(LegislationRow & { fullText?: string }) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>("/legislation", {
        query: { ...(q.trim() ? { q: q.trim() } : {}), ...(docType ? { docType } : {}) },
      });
      setRows(Array.isArray(data) ? (data as LegislationRow[]) : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mevzuat listesi yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [q, docType]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload() {
    setBusy(true);
    setFormError(null);
    try {
      await api("/legislation", {
        method: "POST",
        body: {
          docType: form.docType,
          title: form.title.trim(),
          ...(form.number.trim() ? { number: form.number.trim() } : {}),
          ...(form.year.trim() ? { year: Number(form.year) } : {}),
          ...(form.tags.trim() ? { tags: form.tags.trim() } : {}),
          ...(form.versionNote.trim() ? { versionNote: form.versionNote.trim() } : {}),
          fullText: form.fullText,
        },
      });
      setUploadOpen(false);
      setForm({ docType: "KANUN", title: "", number: "", year: "", tags: "", versionNote: "", fullText: "" });
      setNotice("Mevzuat kaydı eklendi.");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Kayıt eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(row: LegislationRow) {
    try {
      const full = await api<unknown>(`/legislation/${row.id}`);
      setViewRow(full as LegislationRow & { fullText: string });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Detay yüklenemedi.");
    }
  }

  async function remove(id: string) {
    try {
      await api(`/legislation/${id}`, { method: "DELETE" });
      setViewRow(null);
      setNotice("Mevzuat kaydı silindi (geçmiş için yumuşak silme).");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Silinemedi.");
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mevzuat Kütüphanesi</h1>
          <p className="mt-1 text-sm text-slate-600">
            Kanun, KHK, yönetmelik ve tebliğ metinlerinizi yükleyin; tam metin arama yapın.
            <strong className="font-semibold text-slate-700"> Resmî Gazete otomatik senkronu yoktur</strong> — metni
            büronuz yükler ve güncel tutar.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>Mevzuat Yükle</Button>
      </header>

      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}

      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <Input
            placeholder="Ara — başlık, kanun no, tam metin, etiket…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
          >
            <option value="">Tüm türler</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          message={
            q || docType
              ? "Aramanızla eşleşen mevzuat yok."
              : "Kütüphane boş — ilk kanun/yönetmelik metninizi yükleyin."
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <button
              key={row.id}
              onClick={() => void openDetail(row)}
              className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-navy-400 hover:shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={DOC_TYPE_TONES[row.docType] ?? "gray"}>
                  {DOC_TYPE_LABELS[row.docType] ?? row.docType}
                </Badge>
                <span className="font-semibold text-slate-900">{row.title}</span>
                {row.number ? <span className="text-sm text-slate-500">No. {row.number}</span> : null}
                {row.year ? <span className="text-sm text-slate-500">({row.year})</span> : null}
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-slate-600">{row.preview}…</p>
              {row.versionNote ? (
                <p className="mt-1 text-xs text-slate-500">Sürüm: {row.versionNote}</p>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {/* Yükleme iletişim kutusu */}
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Mevzuat Yükle">
        {formError ? <ErrorBox message={formError} /> : null}
        <div className="space-y-3">
          <Field label="Belge türü">
            <select
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
              value={form.docType}
              onChange={(e) => setForm({ ...form, docType: e.target.value })}
            >
              {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Başlık" hint="Resmî başlık — örn. Türk Borçlar Kanunu">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kanun no" hint="Örn. 6098">
              <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
            </Field>
            <Field label="Yıl">
              <Input
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Etiketler" hint="Virgülle — örn. borçlar, sözleşme, temerrüt">
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </Field>
          <Field label="Sürüm notu" hint="Örn. 2026-08 itibarıyla yürürlükteki hâli">
            <Input value={form.versionNote} onChange={(e) => setForm({ ...form, versionNote: e.target.value })} />
          </Field>
          <Field label="Tam metin" hint="En az 50 karakter — kopyala-yapıştır en pratik yol">
            <Textarea
              rows={10}
              value={form.fullText}
              onChange={(e) => setForm({ ...form, fullText: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>
              Vazgeç
            </Button>
            <Button onClick={() => void upload()} disabled={busy}>
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Detay iletişim kutusu */}
      <Modal open={!!viewRow} onClose={() => setViewRow(null)} title={viewRow?.title ?? ""}>
        {viewRow ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={DOC_TYPE_TONES[viewRow.docType] ?? "gray"}>
                {DOC_TYPE_LABELS[viewRow.docType] ?? viewRow.docType}
              </Badge>
              {viewRow.number ? <span className="text-sm text-slate-500">No. {viewRow.number}</span> : null}
              {viewRow.year ? <span className="text-sm text-slate-500">({viewRow.year})</span> : null}
              {viewRow.tags ? <span className="text-sm text-slate-500">{viewRow.tags}</span> : null}
            </div>
            {viewRow.versionNote ? (
              <p className="text-sm font-medium text-slate-700">Sürüm: {viewRow.versionNote}</p>
            ) : null}
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
              {viewRow.fullText}
            </pre>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewRow(null)}>
                Kapat
              </Button>
              <Button
                variant="secondary"
                className="text-red-700"
                onClick={() => void remove(viewRow.id)}
              >
                Sil
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
