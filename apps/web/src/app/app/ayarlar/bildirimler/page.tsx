"use client";

/**
 * Ayarlar → Bildirimler (Enterprise++) — bildirim türü × kanal tercihleri.
 *
 * Kayıt yoksa her kanal AÇIKTIR (varsayılan: süre uyarıları kaybolmaz).
 * "Uygulama içi" kapatılırsa o tür giden kutusuna hiç yazılmaz. E-posta/push
 * tercihleri saklanır; dağıtım ilgili sağlayıcı bağlandığında uygulanır —
 * dürüstlük: ekran kanalın bağlı olup olmadığını gösterir.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorBox, Spinner, SuccessBox, Switch } from "@/components/ui";

interface PrefRow {
  kind: string;
  label: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

interface PrefsResponse {
  items: PrefRow[];
  channels: { inApp: boolean; email: boolean; push: boolean };
}

export default function BildirimlerPage() {
  const [rows, setRows] = useState<PrefRow[]>([]);
  const [channels, setChannels] = useState<PrefsResponse["channels"]>({ inApp: true, email: false, push: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<PrefsResponse>("/notifications/preferences");
      setRows(res.items);
      setChannels(res.channels);
      setDirty(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Tercihler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(kind: string, channel: "inApp" | "email" | "push", next: boolean) {
    setRows((prev) => prev.map((r) => (r.kind === kind ? { ...r, [channel]: next } : r)));
    setDirty(true);
    setNotice(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<PrefsResponse>("/notifications/preferences", {
        method: "PUT",
        body: { items: rows.map(({ kind, inApp, email, push }) => ({ kind, inApp, email, push })) },
      });
      setRows(res.items);
      setDirty(false);
      setNotice("Bildirim tercihleri kaydedildi.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Tercihler yükleniyor…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bildirim Tercihleri</h1>
          <p className="mt-1 text-sm text-slate-500">
            Hangi bildirim türünü hangi kanaldan almak istediğinizi seçin. Süre ve duruşma uyarılarını kapatmak hak
            düşürücü süre riskini size bırakır — dikkatli kullanın.
          </p>
        </div>
        <Button variant="gold" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>

      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Bildirim türü</th>
                <th className="px-3 py-2 font-medium">Uygulama içi</th>
                <th className="px-3 py-2 font-medium">
                  E-posta {!channels.email && <Badge tone="gray">sağlayıcı bağlı değil</Badge>}
                </th>
                <th className="px-3 py-2 font-medium">
                  Mobil push {!channels.push && <Badge tone="gray">sağlayıcı bağlı değil</Badge>}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.kind}>
                  <td className="px-3 py-3">
                    <p className="font-medium text-slate-800">{r.label}</p>
                    <p className="text-[11px] text-slate-500">{r.kind}</p>
                  </td>
                  {(["inApp", "email", "push"] as const).map((ch) => (
                    <td key={ch} className="px-3 py-3">
                      <Switch checked={r[ch]} label={`${r.label} — ${ch}`} onChange={(next) => toggle(r.kind, ch, next)} tone="green" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          E-posta ve push tercihleri kaydedilir; ilgili sağlayıcı (SMTP / push servisi) bağlandığında otomatik uygulanır.
        </p>
      </Card>
    </div>
  );
}
