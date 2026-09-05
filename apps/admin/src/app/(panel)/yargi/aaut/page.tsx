"use client";

/**
 * AAÜT PLATFORM TARİFESİ (açılış öncesi hazır veri planı, Aşama 2).
 *
 * Büro kendi AAÜT tarifesini girmediyse hesap aracı o yılın PLATFORM tarifesini
 * kullanır ve kaynağını (Resmî Gazete künyesi) gösterir. Rakamlar burada RG'den
 * elle girilir — sistem rakam UYDURMAZ; künye zorunludur. Yıl başı işi
 * (aaut-tarife-yilbasi) yeni yılın kaydı yoksa panelde uyarır.
 *
 * Para: TÜM tutarlar KURUŞ cinsinden tam sayı dizgisidir ("3700000" = 37.000,00 TL).
 */

import { useCallback, useEffect, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { can } from "@/lib/rbac";
import { useAdminSession } from "@/lib/session";
import { PageGate } from "@/components/RoleGate";
import { Badge, Button, Card, Field, InfoBox, Input, PageHeader, Textarea } from "@/components/ui";

interface TarifeRow {
  yil: number;
  kademeler: { limitKurus: string | null; ucretKurus: string }[];
  tekrar: { esikKurus: string; birimKurus: string; ucretKurus: string } | null;
  nispiOranYuzde: string;
  kdvOrani: string;
  rgKunye: string | null;
  updatedAt?: string;
}

const SAMPLE_KADEMELER = `[
  { "limitKurus": "20000000", "ucretKurus": "3700000" },
  { "limitKurus": "60000000", "ucretKurus": "5000000" },
  { "limitKurus": null, "ucretKurus": "9000000" }
]`;
const SAMPLE_TEKRAR = `{ "esikKurus": "60000000", "birimKurus": "10000000", "ucretKurus": "300000" }`;

function kurusToTl(kurus: string | null): string {
  if (kurus === null) return "üst sınır yok";
  const n = Number(kurus);
  return Number.isFinite(n) ? `${(n / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL` : kurus;
}

export default function AautPage() {
  return (
    <PageGate action="judicial.view">
      <Aaut />
    </PageGate>
  );
}

function Aaut() {
  const { role } = useAdminSession();
  const canManage = can(role, "judicial.manage");

  const [rows, setRows] = useState<TarifeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    yil: String(new Date().getFullYear()),
    rgKunye: "",
    nispiOranYuzde: "16.00",
    kdvOrani: "20",
    kademelerJson: "",
    tekrarJson: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi<TarifeRow[]>(EP.vekaletTarife.list);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, "Platform tarifeleri yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function editRow(r: TarifeRow) {
    setForm({
      yil: String(r.yil),
      rgKunye: r.rgKunye ?? "",
      nispiOranYuzde: r.nispiOranYuzde,
      kdvOrani: r.kdvOrani,
      kademelerJson: JSON.stringify(r.kademeler, null, 2),
      tekrarJson: r.tekrar ? JSON.stringify(r.tekrar) : "",
    });
    setNotice(null);
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const yil = Number.parseInt(form.yil, 10);
      if (!Number.isInteger(yil) || yil < 2010 || yil > 2100) throw new Error("Yıl 2010-2100 aralığında olmalıdır.");
      const kademeler = JSON.parse(form.kademelerJson) as unknown;
      if (!Array.isArray(kademeler) || kademeler.length === 0) throw new Error("Kademeler bir JSON dizisi olmalı (en az 1).");
      const tekrar = form.tekrarJson.trim() ? (JSON.parse(form.tekrarJson) as unknown) : null;
      await adminApi(EP.vekaletTarife.save(yil), {
        method: "PUT",
        body: {
          kademeler,
          tekrar,
          nispiOranYuzde: form.nispiOranYuzde.trim(),
          kdvOrani: form.kdvOrani.trim(),
          rgKunye: form.rgKunye.trim(),
        },
      });
      setNotice(`${yil} platform tarifesi kaydedildi (${form.rgKunye.trim()}). Kendi tarifesini girmemiş bürolar bu yıl için bunu kullanır.`);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Kaydedilemedi. JSON alanlarını ve kuruş biçimini kontrol edin."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AAÜT Platform Tarifesi"
        description="Avukatlık Asgari Ücret Tarifesi — büro kendi tarifesini girmediyse hesap aracı bu resmî kaydı kullanır ve kaynağını gösterir. Rakamlar Resmî Gazete'den girilir; sistem rakam üretmez."
      />

      <InfoBox title="Veri sözleşmesi">
        Büro kaydı her zaman önceliklidir. Buradaki kayıt yalnız kendi tarifesini girmemiş bürolarda kullanılır ve
        hesap sonucunda &quot;platformun Resmî Gazete'den girdiği resmî tarife (RG künyesi)&quot; olarak görünür.
        Tutarlar KURUŞ cinsinden tam sayıdır (&quot;3700000&quot; = 37.000,00 TL). Yıl başı işi (2 Ocak) yeni yılın
        kaydı yoksa Zamanlanmış İşler'de BAŞARISIZ olarak uyarır.
      </InfoBox>

      {notice ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>
      ) : null}
      {error ? <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card title="Kayıtlı yıllar">
          {loading ? (
            <p className="text-sm text-steel-500">Yükleniyor…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-steel-500">
              Henüz platform tarifesi yok. Sağdaki formdan yılın resmî tarifesini Resmî Gazete künyesiyle girin.
            </p>
          ) : (
            <ul className="divide-y divide-steel-800">
              {rows.map((r) => (
                <li key={r.yil} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-steel-50">{r.yil}</p>
                      <Badge tone="green">{r.rgKunye ?? "künye yok"}</Badge>
                    </div>
                    <p className="text-xs text-steel-500">
                      {r.kademeler.length} kademe · nispi %{r.nispiOranYuzde} · KDV %{r.kdvOrani}
                      {r.tekrar ? ` · tekrar: her ${kurusToTl(r.tekrar.birimKurus)} için ${kurusToTl(r.tekrar.ucretKurus)}` : ""}
                    </p>
                    <p className="text-[11px] text-steel-600">
                      {r.kademeler.map((k) => `≤ ${kurusToTl(k.limitKurus)} → ${kurusToTl(k.ucretKurus)}`).join(" · ")}
                    </p>
                  </div>
                  {canManage ? (
                    <Button size="sm" variant="secondary" onClick={() => editRow(r)}>
                      Düzenle
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Tarife gir / güncelle" subtitle="Resmî Gazete'deki yıl tarifesinden birebir; künye zorunlu.">
          {!canManage ? (
            <p className="text-sm text-steel-500">Tarife girişi için judicial.manage yetkisi gerekir.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Yıl">
                  <Input value={form.yil} onChange={(e) => setForm({ ...form, yil: e.target.value })} />
                </Field>
                <Field label="Nispi oran (%)">
                  <Input value={form.nispiOranYuzde} onChange={(e) => setForm({ ...form, nispiOranYuzde: e.target.value })} placeholder="16.00" />
                </Field>
                <Field label="KDV (%)">
                  <Input value={form.kdvOrani} onChange={(e) => setForm({ ...form, kdvOrani: e.target.value })} placeholder="20" />
                </Field>
                <Field label="RG künyesi (zorunlu)">
                  <Input value={form.rgKunye} onChange={(e) => setForm({ ...form, rgKunye: e.target.value })} placeholder="RG 21.12.2025 / 32784" />
                </Field>
              </div>
              <Field label="Maktu kademeler (JSON, kuruş)" hint="Son kademede limitKurus: null → üst sınır yok.">
                <Textarea
                  rows={7}
                  value={form.kademelerJson}
                  onChange={(e) => setForm({ ...form, kademelerJson: e.target.value })}
                  placeholder={SAMPLE_KADEMELER}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Tekrar dilimi (JSON, isteğe bağlı)" hint="Eşik üzeri her birim için ek ücret; yoksa boş bırakın.">
                <Textarea
                  rows={2}
                  value={form.tekrarJson}
                  onChange={(e) => setForm({ ...form, tekrarJson: e.target.value })}
                  placeholder={SAMPLE_TEKRAR}
                  className="font-mono text-xs"
                />
              </Field>
              <div className="flex justify-end">
                <Button
                  onClick={() => void save()}
                  disabled={busy || form.rgKunye.trim().length < 6 || form.kademelerJson.trim().length < 5}
                >
                  {busy ? "Kaydediliyor…" : "Kaydet"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
