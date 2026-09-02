"use client";

/**
 * RANDEVULAR (E9 — rakip analizi): büro ajandası.
 *
 * GET  /randevular              — tüm randevular (tarih aralıklı)
 * POST /randevular              — yeni randevu (tüm roller alabilir)
 * PATCH /randevular/:id         — durum değişimi (PLANLANDI/IPTAL/TAMAMLANDI)
 *
 * ÇAKIŞMA KAPISI sunucudadır: aynı büroda KESİŞEN randevu 409 alır.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, EmptyState, ErrorBox, Input, Modal } from "@/components/ui";

interface Randevu {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: "PLANLANDI" | "IPTAL" | "TAMAMLANDI";
  note: string | null;
  client: { id: string; name: string } | null;
  portalUserId: string | null;
}

const STATUS_TONES: Record<string, "blue" | "gray" | "green"> = {
  PLANLANDI: "blue",
  IPTAL: "gray",
  TAMAMLANDI: "green",
};

const STATUS_LABELS: Record<string, string> = {
  PLANLANDI: "Planlandı",
  IPTAL: "İptal",
  TAMAMLANDI: "Tamamlandı",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", weekday: "short" });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

export default function RandevularPage() {
  const [rows, setRows] = useState<Randevu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", startAt: "", endAt: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ rows: Randevu[]; total: number }>("/randevular");
      setRows(res.rows ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Randevular yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function randevuOlustur() {
    if (!form.title.trim() || !form.startAt || !form.endAt) return;
    setBusy(true);
    setError(null);
    try {
      await api("/randevular", {
        method: "POST",
        body: {
          title: form.title.trim(),
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
        },
      });
      setModalOpen(false);
      setForm({ title: "", startAt: "", endAt: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Randevu oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function durumDegistir(id: string, status: string) {
    setBusy(true);
    try {
      await api(`/randevular/${id}`, { method: "PATCH", body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Durum değiştirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  const now = new Date();
  const upcoming = rows.filter((r) => new Date(r.startAt) >= now && r.status === "PLANLANDI");
  const past = rows.filter((r) => new Date(r.startAt) < now || r.status !== "PLANLANDI");

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Randevular</h1>
          <p className="mt-1 text-sm text-slate-600">
            Büro ajandası — müvekkil portaldan gelen randevular dahil. Çakışan saatler
            otomatik engellenir.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>Yeni Randevu</Button>
      </header>

      {error && <ErrorBox message={error} />}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">Yükleniyor…</p>
      ) : rows.length === 0 ? (
        <EmptyState message="Henüz randevu yok. Yukarıdaki 'Yeni Randevu' düğmesiyle ilk randevunuzu planlayın. Müvekkil portaldan da randevu alınabilir." />
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Yaklaşan Randevular</h2>
              <ul className="space-y-2">
                {upcoming.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{r.title}</p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {fmtDate(r.startAt)} · {fmtTime(r.startAt)}–{fmtTime(r.endAt)}
                        {r.client && ` · ${r.client.name}`}
                        {r.portalUserId && " (portaldan)"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void durumDegistir(r.id, "TAMAMLANDI")}
                      >
                        Tamamlandı
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void durumDegistir(r.id, "IPTAL")}
                      >
                        İptal
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Geçmiş / Diğer</h2>
              <ul className="space-y-2">
                {past.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 opacity-75"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700">{r.title}</p>
                      <p className="text-xs text-slate-500">
                        {fmtDate(r.startAt)} · {fmtTime(r.startAt)}
                        {r.client && ` · ${r.client.name}`}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Yeni Randevu">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void randevuOlustur();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700">Konu</label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="örn. İcra dosyası bilgilendirme"
              maxLength={200}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700">Başlangıç</label>
              <Input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Bitiş</label>
              <Input
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                required
              />
            </div>
          </div>
          {error && <ErrorBox message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={busy || !form.title.trim() || !form.startAt || !form.endAt}>
              {busy ? "Kaydediliyor…" : "Randevu Oluştur"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
