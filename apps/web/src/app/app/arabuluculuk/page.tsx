"use client";

/**
 * ARABULUCULUK (D2 A2) — dava şartı arabuluculuk süreç yönetimi.
 *
 * Durum zinciri: DAVET → TOPLANTI → SONUC → (ANLASMA | ANLASMA_YOK) → DAVA_ACILDI.
 * ANLASMA_YOK'ta son tutanak tarihi istenir; 6325 m.18 2 haftalık dava süresi
 * SUNUCUDA kural motorundan hesaplanır ve ajandaya düşer.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";

interface MediationRow {
  id: string;
  title: string;
  status: string;
  caseId: string | null;
  case?: { id: string; title: string; fileNumber: string | null } | null;
  meetingAt: string | null;
  finalProtocolAt: string | null;
  settlementAmount: string | null;
  note: string | null;
  createdAt: string;
}

interface CaseOption {
  id: string;
  title: string;
  fileNumber: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  DAVET: "Davet gönderildi",
  TOPLANTI: "Toplantı planlandı",
  SONUC: "Sonuç tutanağı",
  ANLASMA: "Anlaşma",
  ANLASMA_YOK: "Anlaşma yok",
  DAVA_ACILDI: "Dava açıldı",
  FERAGAT: "Feragat",
};

const STATUS_TONES: Record<string, "blue" | "green" | "gray" | "red" | "navy"> = {
  DAVET: "blue",
  TOPLANTI: "blue",
  SONUC: "navy",
  ANLASMA: "green",
  ANLASMA_YOK: "red",
  DAVA_ACILDI: "navy",
  FERAGAT: "gray",
};

/** Durum geçiş düğmeleri (sunucudaki ALLOWED zinciriyle aynı). */
const NEXT: Record<string, Array<"TOPLANTI" | "SONUC" | "ANLASMA" | "ANLASMA_YOK" | "DAVA_ACILDI" | "FERAGAT">> = {
  DAVET: ["TOPLANTI", "FERAGAT", "SONUC"],
  TOPLANTI: ["SONUC", "FERAGAT"],
  SONUC: ["ANLASMA", "ANLASMA_YOK"],
  ANLASMA: [],
  ANLASMA_YOK: ["DAVA_ACILDI"],
  DAVA_ACILDI: [],
  FERAGAT: [],
};

export default function ArabuluculukPage() {
  const [rows, setRows] = useState<MediationRow[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", caseId: "", meetingAt: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [transMed, setTransMed] = useState<MediationRow | null>(null);
  const [transForm, setTransForm] = useState({ status: "", meetingAt: "", finalProtocolAt: "", settlementAmount: "" });
  const [transBusy, setTransBusy] = useState(false);
  const [transError, setTransError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>("/mediations");
      setRows(Array.isArray(data) ? (data as MediationRow[]) : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kayıtlar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      try {
        const res = await api<unknown>("/cases", { query: { limit: "100" } });
        const items = (Array.isArray(res) ? res : ((res as { items?: unknown[] }).items ?? [])) as Array<{
          id: string;
          title: string;
          fileNumber: string | null;
        }>;
        setCases(items.map((c) => ({ id: c.id, title: c.title, fileNumber: c.fileNumber })));
      } catch {
        /* dosya listesi opsiyonel */
      }
    })();
  }, [load]);

  async function create() {
    setBusy(true);
    setFormError(null);
    try {
      await api("/mediations", {
        method: "POST",
        body: {
          title: form.title.trim(),
          ...(form.caseId ? { caseId: form.caseId } : {}),
          ...(form.meetingAt ? { meetingAt: new Date(form.meetingAt).toISOString() } : {}),
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      });
      setCreateOpen(false);
      setForm({ title: "", caseId: "", meetingAt: "", note: "" });
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Kayıt açılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function transition() {
    if (!transMed) return;
    setTransBusy(true);
    setTransError(null);
    try {
      const res = await api<{ lawsuitDeadlineId?: string | null }>(`/mediations/${transMed.id}/transition`, {
        method: "POST",
        body: {
          status: transForm.status,
          ...(transForm.meetingAt ? { meetingAt: new Date(transForm.meetingAt).toISOString() } : {}),
          ...(transForm.finalProtocolAt
            ? { finalProtocolAt: new Date(transForm.finalProtocolAt).toISOString() }
            : {}),
          ...(transForm.settlementAmount
            ? { settlementAmount: Number(transForm.settlementAmount.replace(",", ".")) }
            : {}),
        },
      });
      setTransMed(null);
      setNotice(
        res.lawsuitDeadlineId
          ? "Durum güncellendi — 2 haftalık dava süresi hesaplandı ve ajandaya eklendi (6325 s.K. m.18)."
          : "Durum güncellendi.",
      );
      await load();
    } catch (err) {
      setTransError(err instanceof ApiError ? err.message : "Geçiş başarısız.");
    } finally {
      setTransBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Arabuluculuk</h1>
          <p className="mt-1 text-sm text-slate-500">
            Dava şartı arabuluculuk süreçleri — anlaşma yoksa 2 haftada dava açılır (6325 s.K. m.18).
          </p>
        </div>
        <Button variant="gold" onClick={() => setCreateOpen(true)}>
          + Yeni Süreç
        </Button>
      </div>

      {notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</p>
      )}
      {error && <ErrorBox message={error} />}

      <Card>
        {loading ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState message="Henüz arabuluculuk kaydı yok." />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((m) => (
              <div key={m.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {m.title}
                      <Badge tone={STATUS_TONES[m.status] ?? "gray"}>{STATUS_LABELS[m.status] ?? m.status}</Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {m.case ? `Dosya: ${m.case.title}` : "Dosya bağlı değil"}
                      {m.meetingAt && ` · Toplantı: ${new Date(m.meetingAt).toLocaleString("tr-TR")}`}
                      {m.finalProtocolAt && ` · Son tutanak: ${new Date(m.finalProtocolAt).toLocaleDateString("tr-TR")}`}
                      {m.settlementAmount && ` · Anlaşma: ${Number(m.settlementAmount).toLocaleString("tr-TR")} TL`}
                    </p>
                    {m.note && <p className="mt-1 text-xs text-slate-500">{m.note}</p>}
                  </div>
                  {(NEXT[m.status] ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(NEXT[m.status] ?? []).map((next) => (
                        <Button
                          key={next}
                          variant={next === "ANLASMA_YOK" ? "danger" : "secondary"}
                          onClick={() => {
                            setTransMed(m);
                            setTransForm({
                              status: next,
                              meetingAt: "",
                              finalProtocolAt: "",
                              settlementAmount: next === "ANLASMA" ? "" : "",
                            });
                            setTransError(null);
                          }}
                        >
                          → {STATUS_LABELS[next]}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Yeni süreç modalı */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Yeni Arabuluculuk Süreci">
        <div className="space-y-4">
          <Field label="Başlık" hint="Örn. İşe iade — arabuluculuk daveti">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Dosya" hint="Dava süresi hesabı için dosya bağlanmalıdır.">
            <Select value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
              <option value="">Dosya seç…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.fileNumber ? ` (${c.fileNumber})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Toplantı tarihi (planlandıysa)">
            <Input
              type="datetime-local"
              value={form.meetingAt}
              onChange={(e) => setForm({ ...form, meetingAt: e.target.value })}
            />
          </Field>
          <Field label="Not">
            <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          {formError && <ErrorBox message={formError} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Vazgeç
            </Button>
            <Button disabled={busy || form.title.trim().length < 3} onClick={() => void create()}>
              {busy ? "Açılıyor…" : "Süreci Başlat"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Durum geçişi modalı */}
      <Modal
        open={transMed !== null}
        onClose={() => setTransMed(null)}
        title={`Durum Değiştir — ${transMed?.title ?? ""}`}
      >
        <div className="space-y-4">
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-4 text-slate-600">
            Yeni durum: <strong>{transForm.status ? STATUS_LABELS[transForm.status] : ""}</strong>
            {transForm.status === "ANLASMA_YOK" && (
              <>
                {" "}— son tutanak tarihi zorunludur; 6325 s.K. m.18 uyarınca{" "}
                <strong>2 haftalık dava açma süresi</strong> otomatik hesaplanır ve ajandaya eklenir.
              </>
            )}
          </p>
          {transForm.status === "ANLASMA" && (
            <Field label="Anlaşılan tutar (TL)">
              <Input
                value={transForm.settlementAmount}
                onChange={(e) => setTransForm({ ...transForm, settlementAmount: e.target.value })}
                inputMode="decimal"
                placeholder="50000"
              />
            </Field>
          )}
          {transForm.status === "ANLASMA_YOK" && (
            <Field label="Son tutanak tarihi" hint="Dava süresi bu tarihten hesaplanır.">
              <Input
                type="date"
                value={transForm.finalProtocolAt}
                onChange={(e) => setTransForm({ ...transForm, finalProtocolAt: e.target.value })}
              />
            </Field>
          )}
          {transForm.status === "TOPLANTI" && (
            <Field label="Toplantı tarihi">
              <Input
                type="datetime-local"
                value={transForm.meetingAt}
                onChange={(e) => setTransForm({ ...transForm, meetingAt: e.target.value })}
              />
            </Field>
          )}
          {transError && <ErrorBox message={transError} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTransMed(null)}>
              Vazgeç
            </Button>
            <Button disabled={transBusy} onClick={() => void transition()}>
              {transBusy ? "Uygulanıyor…" : "Uygula"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
