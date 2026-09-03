"use client";

/**
 * D6 — MÜKERRER MÜVEKKİL BİRLEŞTİRME DİYALOĞU (Modül 01 kural 10).
 *
 * İKİ ADIMLI onay: 1) kaynak kartı seç + taşınacak kayıt sayılarını GÖR
 * (merge-preview ucu — kural 10 gereği sayılar kullanıcıya gösterilir),
 * 2) açık onay. İşlem GERİ ALINAMAZ; kaynak kart pasifleşir (silinmez).
 * Rol kapısı SUNUCUDADIR (ADMIN/PARTNER); arayüz yalnız sunucu hatasını gösterir.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorBox, Field, Modal, Select, Spinner } from "@/components/ui";

interface ClientRow {
  id: string;
  name: string;
  isActive?: boolean;
}

interface MergePreview {
  target: { id: string; name: string };
  source: { id: string; name: string };
  counts: Record<string, number>;
  totalCount: number;
  warning: string;
}

export function ClientMergeDialog({
  open,
  onClose,
  targetId,
  targetName,
}: {
  open: boolean;
  onClose: () => void;
  targetId: string;
  targetName: string;
}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const loadClients = useCallback(async () => {
    try {
      const data = await api<unknown>("/clients", { query: { limit: 200 } });
      const items = (data as { items?: ClientRow[] }).items ?? (data as ClientRow[]);
      setClients((Array.isArray(items) ? items : []).filter((c) => c.id !== targetId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Müvekkil listesi alınamadı.");
    }
  }, [targetId]);

  useEffect(() => {
    if (open) void loadClients();
  }, [open, loadClients]);

  function reset() {
    setSourceId("");
    setPreview(null);
    setError(null);
    setConfirmed(false);
    setBusy(false);
  }

  async function loadPreview() {
    if (!sourceId) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const data = await api<MergePreview>(`/clients/${targetId}/merge-preview`, {
        query: { source: sourceId },
      });
      setPreview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Öngörü alınamadı.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function merge() {
    if (!sourceId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/clients/${targetId}/merge`, {
        method: "POST",
        body: { sourceClientId: sourceId },
      });
      setNotice("Birleştirme tamamlandı — kaynak kartın kayıtları bu karta taşındı ve kaynak kart pasifleştirildi.");
      reset();
      onClose();
      // Sayfayı tazele ki taşınan kayıtlar (dosya sayısı vb.) görünsün.
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Birleştirme başarısız.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {notice ? (
        <p className="fixed bottom-4 right-4 z-50 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-lg">
          {notice}
        </p>
      ) : null}
      <Modal
        open={open}
        onClose={() => {
          reset();
          onClose();
        }}
        title="Mükerrer Kartı Birleştir"
      >
        {error && !busy ? <ErrorBox message={error} /> : null}
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Hedef kart (kalan): <strong>{targetName}</strong>. Aşağıdan <strong>birleştirilecek kaynak kartı</strong>{" "}
            seçin — kaynak kartın TÜM kayıtları (dosyalar, vekaletnameler, finans, faturalar…) bu karta taşınır ve
            kaynak kart <strong>pasifleşir</strong>. İşlem <strong>geri alınamaz</strong>.
          </p>

          <Field label="Kaynak kart (birleştirilecek)">
            <Select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPreview(null); setConfirmed(false); }}>
              <option value="">Seçin…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isActive === false ? " (pasif)" : ""}
                </option>
              ))}
            </Select>
          </Field>

          {sourceId && !preview && (
            <Button variant="secondary" disabled={previewLoading} onClick={() => void loadPreview()}>
              {previewLoading ? "Sayılıyor…" : "Taşınacakları Önizle"}
            </Button>
          )}

          {previewLoading && (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-800">
                {preview.source.name} → {preview.target.name}: toplam {preview.totalCount} kayıt taşınır
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-3">
                {Object.entries(preview.counts)
                  .filter(([, n]) => n > 0)
                  .map(([label, n]) => (
                    <p key={label} className="flex justify-between gap-2">
                      <span className="text-slate-600">{label}</span>
                      <span className="font-semibold text-slate-800">{n}</span>
                    </p>
                  ))}
                {preview.totalCount === 0 && (
                  <p className="text-slate-500">Taşınacak kayıt yok (yalnızca kart pasifleşir).</p>
                )}
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <strong>{preview.source.name}</strong> kartının yukarıdaki {preview.totalCount} kaydının{" "}
                  <strong>{preview.target.name}</strong> kartına taşınacağını ve işlemin{" "}
                  <strong>geri alınamayacağını</strong> anladım.
                </span>
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    reset();
                    onClose();
                  }}
                >
                  Vazgeç
                </Button>
                <Button disabled={!confirmed || busy} onClick={() => void merge()}>
                  {busy ? "Birleştiriliyor…" : "Birleştir"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
