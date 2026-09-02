"use client";

/**
 * Randevularım — E9 (rakip analizi): müvekkil portalı self-servis randevu.
 *
 * GET  /portal/randevular            — yaklaşan planlanmış randevularım
 * POST /portal/randevular            — yeni randevu AL (süre sabit 30 dk)
 * POST /portal/randevular/:id/iptal  — randevumu iptal et
 *
 * ÇAKIŞMA KAPISI sunucudadadır: büronun takviminde aynı saatte başka bir
 * randevu varsa istek 409 alır ve kullanıcı başka saat seçer.
 */

import { useCallback, useState } from "react";
import { EP } from "@/lib/endpoints";
import { useListResource } from "@/lib/useResource";
import { portalApi, errorMessage } from "@/lib/api";
import { fmtDayHeading } from "@/lib/labels";
import {
  Badge,
  Button,
  Input,
  PageHeader,
  ResourceView,
} from "@/components/ui";

interface PortalRandevu {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  note: string | null;
}

export default function RandevularPage() {
  const randevular = useListResource<PortalRandevu>(EP.randevular);
  const [yeniOpen, setYeniOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", tarih: "", saat: "10:00" });

  const refresh = useCallback(() => {
    randevular.reload();
  }, [randevular]);

  async function randevuAl() {
    if (!form.title.trim() || !form.tarih || !form.saat) {
      setError("Konu, tarih ve saat zorunludur.");
      return;
    }
    setBusy(true);
    setError(null);
    setBasari(null);
    try {
      const startAt = new Date(`${form.tarih}T${form.saat}:00`);
      await portalApi(EP.randevular, {
        method: "POST",
        body: { title: form.title.trim(), startAt: startAt.toISOString() },
      });
      setBasari("Randevunuz alındı; büronuz onayıyla kesinleşir.");
      setForm({ title: "", tarih: "", saat: "10:00" });
      setYeniOpen(false);
      refresh();
    } catch (err) {
      setError(errorMessage(err, "Randevu alınamadı."));
    } finally {
      setBusy(false);
    }
  }

  async function iptal(id: string) {
    if (!window.confirm("Bu randevuyu iptal etmek istediğinizden emin misiniz?")) return;
    setBusy(true);
    setError(null);
    try {
      await portalApi(EP.randevuIptal(id), { method: "POST" });
      setBasari("Randevu iptal edildi.");
      refresh();
    } catch (err) {
      setError(errorMessage(err, "Randevu iptal edilemedi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Randevularım"
        description="Büronuzla yüz yüze veya telefon görüşmesi planlayın. Randevu süresi 30 dakikadır."
        action={
          !yeniOpen && (
            <Button size="sm" onClick={() => setYeniOpen(true)}>
              Randevu Al
            </Button>
          )
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}
      {basari && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700" role="status">
          {basari}
        </div>
      )}

      {yeniOpen && (
        <div className="mb-6 rounded-[6px] border border-rule bg-paper p-5">
          <h2 className="mb-4 font-serif text-lg font-semibold text-ink">Yeni Randevu</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="randevu-konu">Görüşme konusu</label>
              <Input
                id="randevu-konu"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="ör. İcra dosyası hakkında bilgilendirme"
                maxLength={200}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="randevu-tarih">Tarih</label>
                <Input
                  id="randevu-tarih"
                  type="date"
                  value={form.tarih}
                  onChange={(e) => setForm({ ...form, tarih: e.target.value })}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div>
                <label htmlFor="randevu-saat">Saat</label>
                <Input
                  id="randevu-saat"
                  type="time"
                  value={form.saat}
                  onChange={(e) => setForm({ ...form, saat: e.target.value })}
                  step="1800"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onClick={() => setYeniOpen(false)}>
                Vazgeç
              </Button>
              <Button onClick={() => void randevuAl()} disabled={busy}>
                {busy ? "Alınıyor…" : "Randevu Al"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ResourceView
        loading={randevular.loading}
        missing={randevular.missing}
        forbidden={randevular.forbidden}
        error={randevular.error}
        empty={randevular.empty}
        endpoint={randevular.endpoint}
        onRetry={randevular.reload}
        loadingLabel="Randevularınız getiriliyor…"
        emptyMessage="Planlanmış bir randevunuz yok."
        emptyHint="Yukarıdaki “Randevu Al” düğmesiyle büronuzla görüşme planlayabilirsiniz."
      >
        <ul className="space-y-3">
          {(randevular.data ?? []).map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 rounded-[6px] border border-rule bg-paper p-4"
            >
              <div>
                <p className="font-medium text-ink">{r.title}</p>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {fmtDayHeading(new Date(r.startAt))} ·{" "}
                  {new Date(r.startAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}–
                  {new Date(r.endAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="good">Planlandı</Badge>
                <Button
                  size="sm"
variant="quiet"
                  disabled={busy}
                  onClick={() => void iptal(r.id)}
                >
                  İptal Et
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </ResourceView>

      <div className="mt-6 flex items-start gap-2 rounded-xl bg-paper-alt/70 px-4 py-3 text-sm leading-relaxed text-ink-soft">
        <span aria-hidden="true" className="mt-0.5 text-gold-deep">🔒</span>
        <p>
          Randevu kaydınız yalnızca büronuzla paylaşılır. Çakışan saat seçerseniz sistem sizi
          uyarır; başka bir saat seçmeniz istenir.
        </p>
      </div>
    </div>
  );
}
