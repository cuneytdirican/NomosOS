"use client";

/**
 * KONKORDATO / İFLAS (D4 / A6) — süreç takibi.
 *
 * İki şerit: CONCORDATO (İİK m.285-302) ve IFLAS (m.154-168). Aşama
 * geçişleri sunucudaki şeritle denetlenir; keyfi sıçrama reddedilir.
 * Otomatik yasal süre üretimi YOKTUR — süre hükümleri koşulludur;
 * süreler Süreler ekranından kurulur.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";

interface ConcordatoRow {
  id: string;
  processType: string;
  status: string;
  court: string | null;
  fileNo: string | null;
  stageAt: string | null;
  note: string | null;
  createdAt: string;
  case?: { id: string; title: string; fileNumber: string | null } | null;
}

const TYPE_LABELS: Record<string, string> = {
  CONCORDATO: "Konkordato",
  IFLAS: "İflas",
};

const CONCORDATO_LABELS: Record<string, string> = {
  BASVURU: "Başvuru (m.285)",
  ON_INCELEME: "Ön inceleme",
  GECICI_ERTELEME: "Geçici erteleme (m.286)",
  KESIN_ERTELEME: "Kesin erteleme (m.287)",
  ONAYLANDI: "Onaylandı",
  REDDEDILDI: "Reddedildi",
  FERAGAT: "Feragat",
};

const IFLAS_LABELS: Record<string, string> = {
  TALEP: "İflas talebi (m.155+)",
  GECIKME: "Gecikme kararı (m.166)",
  IFLAS_KARARI: "İflas kararı",
  IFLAS_IDARESI: "İflas idaresi",
  INFIS: "İnfis",
  SONA_ERDI: "Sona erdi",
  RED: "Talebin reddi",
};

/** Sunucudaki şeritle AYNI geçişler (concordato.service.ts). */
const CONCORDATO_NEXT: Record<string, string[]> = {
  BASVURU: ["ON_INCELEME", "FERAGAT", "REDDEDILDI"],
  ON_INCELEME: ["GECICI_ERTELEME", "REDDEDILDI", "FERAGAT"],
  GECICI_ERTELEME: ["KESIN_ERTELEME", "REDDEDILDI", "FERAGAT"],
  KESIN_ERTELEME: ["ONAYLANDI", "REDDEDILDI", "FERAGAT"],
  ONAYLANDI: [],
  REDDEDILDI: [],
  FERAGAT: [],
};

const IFLAS_NEXT: Record<string, string[]> = {
  TALEP: ["GECIKME", "IFLAS_KARARI", "RED"],
  GECIKME: ["IFLAS_KARARI", "RED"],
  IFLAS_KARARI: ["IFLAS_IDARESI", "SONA_ERDI"],
  IFLAS_IDARESI: ["INFIS", "SONA_ERDI"],
  INFIS: [],
  SONA_ERDI: [],
  RED: [],
};

function labelsOf(row: ConcordatoRow) {
  return row.processType === "IFLAS" ? IFLAS_LABELS : CONCORDATO_LABELS;
}

export default function ConcordatoPage() {
  const [rows, setRows] = useState<ConcordatoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ processType: "CONCORDATO", court: "", fileNo: "", stageAt: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>("/concordatos", {
        query: typeFilter ? { processType: typeFilter } : {},
      });
      setRows(Array.isArray(data) ? (data as ConcordatoRow[]) : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kayıtlar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setFormError(null);
    try {
      await api("/concordatos", {
        method: "POST",
        body: {
          processType: form.processType,
          ...(form.court.trim() ? { court: form.court.trim() } : {}),
          ...(form.fileNo.trim() ? { fileNo: form.fileNo.trim() } : {}),
          ...(form.stageAt ? { stageAt: new Date(form.stageAt).toISOString() } : {}),
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      });
      setCreateOpen(false);
      setForm({ processType: "CONCORDATO", court: "", fileNo: "", stageAt: "", note: "" });
      setNotice("Süreç kaydı açıldı.");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Kayıt açılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(row: ConcordatoRow, status: string) {
    setBusy(true);
    try {
      await api(`/concordatos/${row.id}/transition`, {
        method: "POST",
        body: { status, stageAt: new Date().toISOString() },
      });
      setNotice(`Aşama güncellendi: ${labelsOf(row)[status] ?? status}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Aşama değiştirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Konkordato / İflas</h1>
          <p className="mt-1 text-sm text-slate-600">
            Konkordato (İİK m.285-302) ve iflas (m.154-168) süreçlerinin aşama takibi. Aşama
            geçişleri kanun akışıyla sınırlıdır; otomatik süre hesabı yapılmaz — süreleri Süreler
            ekranından kurun.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Süreç Aç</Button>
      </header>

      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}

      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <Input placeholder="Mahkeme / esas no ile aramak için filtre kullanın" disabled />
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Tüm süreçler</option>
            <option value="CONCORDATO">Konkordato</option>
            <option value="IFLAS">İflas</option>
          </Select>
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState message="Henüz konkordato/iflas kaydı yok." />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const next = (row.processType === "IFLAS" ? IFLAS_NEXT : CONCORDATO_NEXT)[row.status] ?? [];
            const labels = labelsOf(row);
            return (
              <Card key={row.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.processType === "IFLAS" ? "red" : "navy"}>
                    {TYPE_LABELS[row.processType] ?? row.processType}
                  </Badge>
                  <Badge tone={row.status === "ONAYLANDI" || row.status === "INFIS" ? "green" : "blue"}>
                    {labels[row.status] ?? row.status}
                  </Badge>
                  {row.court ? <span className="text-sm text-slate-700">{row.court}</span> : null}
                  {row.fileNo ? <span className="text-sm text-slate-500">Esas {row.fileNo}</span> : null}
                </div>
                {row.stageAt ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Aşama tarihi: {new Date(row.stageAt).toLocaleDateString("tr-TR")}
                  </p>
                ) : null}
                {row.note ? <p className="mt-1 text-sm text-slate-600">{row.note}</p> : null}
                {next.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {next.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void transition(row, s)}
                      >
                        → {labels[s] ?? s}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Süreç tamamlandı.</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Konkordato / İflas Süreci Aç">
        {formError ? <ErrorBox message={formError} /> : null}
        <div className="space-y-3">
          <Field label="Süreç türü">
            <Select
              value={form.processType}
              onChange={(e) => setForm({ ...form, processType: e.target.value })}
            >
              <option value="CONCORDATO">Konkordato (m.285+)</option>
              <option value="IFLAS">İflas (m.154+)</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mahkeme">
              <Input value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })} />
            </Field>
            <Field label="Esas no">
              <Input value={form.fileNo} onChange={(e) => setForm({ ...form, fileNo: e.target.value })} />
            </Field>
          </div>
          <Field label="Aşama tarihi">
            <Input
              type="date"
              value={form.stageAt}
              onChange={(e) => setForm({ ...form, stageAt: e.target.value })}
            />
          </Field>
          <Field label="Not">
            <Textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Vazgeç
            </Button>
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? "Açılıyor…" : "Aç"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
