"use client";

/**
 * Ayarlar → Entegrasyonlar (Enterprise++): API anahtarları + webhook'lar.
 *
 * API anahtarı salt-okunur ve kapsamlıdır; düz anahtar yalnız oluşturma anında
 * gösterilir. Webhook olayları denetim izi eylemleridir; teslimatlar HMAC
 * imzalıdır ve geri çekilmeyle yeniden denenir. ADMIN/PARTNER.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, CopyOnceField, EmptyState, ErrorBox, Field, Input, Modal, Spinner, SuccessBox, Switch } from "@/components/ui";

interface ApiKeyRow {
  id: string;
  name: string;
  masked: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  isActive: boolean;
  deliveries: Record<string, number>;
  createdAt: string;
}
interface EventDef {
  action: string;
  label: string;
  group: string;
}
interface DeliveryRow {
  id: string;
  event: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastResponseCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("tr-TR") : "—");

export default function EntegrasyonlarPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [scopes, setScopes] = useState<Array<{ key: string; label: string }>>([]);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [events, setEvents] = useState<EventDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [keyOpen, setKeyOpen] = useState(false);
  const [keyForm, setKeyForm] = useState<{ name: string; scopes: string[]; expiresAt: string }>({ name: "", scopes: [], expiresAt: "" });
  const [plainKey, setPlainKey] = useState<string | null>(null);

  const [hookOpen, setHookOpen] = useState(false);
  const [hookForm, setHookForm] = useState<{ url: string; description: string; events: string[] }>({ url: "", description: "", events: [] });
  const [hookSecret, setHookSecret] = useState<string | null>(null);
  const [deliveriesOf, setDeliveriesOf] = useState<{ hook: WebhookRow; items: DeliveryRow[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [k, w] = await Promise.all([
        api<{ items: ApiKeyRow[]; scopes: Array<{ key: string; label: string }> }>("/integrations/api-keys"),
        api<{ items: WebhookRow[]; events: EventDef[] }>("/integrations/webhooks"),
      ]);
      setKeys(k.items);
      setScopes(k.scopes);
      setWebhooks(w.items);
      setEvents(w.events);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Entegrasyonlar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ plainKey: string }>("/integrations/api-keys", {
        method: "POST",
        body: { name: keyForm.name.trim(), scopes: keyForm.scopes, ...(keyForm.expiresAt ? { expiresAt: keyForm.expiresAt } : {}) },
      });
      setPlainKey(res.plainKey);
      setKeyForm({ name: "", scopes: [], expiresAt: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Anahtar oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(k: ApiKeyRow) {
    if (!window.confirm(`"${k.name}" anahtarı iptal edilecek; onu kullanan entegrasyon anında duracak. Devam?`)) return;
    setBusy(true);
    try {
      await api(`/integrations/api-keys/${k.id}`, { method: "DELETE" });
      setNotice("Anahtar iptal edildi.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İptal edilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function createHook() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ secret: string }>("/integrations/webhooks", {
        method: "POST",
        body: { url: hookForm.url.trim(), events: hookForm.events, ...(hookForm.description.trim() ? { description: hookForm.description.trim() } : {}) },
      });
      setHookSecret(res.secret);
      setHookForm({ url: "", description: "", events: [] });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Webhook kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHook(h: WebhookRow, next: boolean) {
    setBusy(true);
    try {
      await api(`/integrations/webhooks/${h.id}`, { method: "PATCH", body: { isActive: next } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Güncellenemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function removeHook(h: WebhookRow) {
    if (!window.confirm(`${h.url} silinsin mi? Teslimat geçmişi de silinir.`)) return;
    setBusy(true);
    try {
      await api(`/integrations/webhooks/${h.id}`, { method: "DELETE" });
      setNotice("Webhook silindi.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Silinemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function testHook(h: WebhookRow) {
    setBusy(true);
    try {
      await api(`/integrations/webhooks/${h.id}/test`, { method: "POST" });
      setNotice("Test teslimatı kuyruğa alındı; dağıtım işi en geç 5 dakika içinde gönderir. Sonucu 'Teslimatlar'dan izleyin.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test gönderilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function showDeliveries(h: WebhookRow) {
    try {
      const res = await api<{ items: DeliveryRow[] }>(`/integrations/webhooks/${h.id}/deliveries`);
      setDeliveriesOf({ hook: h, items: res.items });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Teslimatlar alınamadı.");
    }
  }

  const groups = [...new Set(events.map((e) => e.group))];

  if (loading) return <Spinner label="Entegrasyonlar yükleniyor…" />;
  if (forbidden) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Entegrasyonlar</h1>
        <Card>
          <p className="p-5 text-sm text-slate-600">
            Entegrasyon yönetimi <strong>Ortak</strong> ve <strong>Yönetici</strong> rollerine açıktır.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Entegrasyonlar</h1>
        <p className="mt-1 text-sm text-slate-500">
          Dış sistemlere (muhasebe, DMS, BI) salt-okunur API anahtarı verin; olayları HMAC imzalı webhook ile alın.
        </p>
      </div>

      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}

      <Card
        title="API anahtarları"
        action={
          <Button variant="gold" size="sm" onClick={() => { setPlainKey(null); setKeyOpen(true); }}>
            + Anahtar
          </Button>
        }
      >
        <p className="mb-3 text-xs text-slate-500">
          Anahtarlar <strong>salt-okunurdur</strong> (yalnız GET) ve seçilen kapsamlarla sınırlıdır; gizli dosyalar API anahtarına görünmez.
          Kullanım: <code>X-Api-Key: nos_…</code> başlığı.
        </p>
        {keys.length === 0 ? (
          <EmptyState message="Henüz API anahtarı yok." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{k.name}</p>
                    <code className="text-xs text-slate-500">{k.masked}</code>
                    {k.revokedAt ? <Badge tone="gray">İptal</Badge> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <Badge tone="danger">Süresi doldu</Badge> : <Badge tone="green">Aktif</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">
                    {k.scopes.join(", ")} · son kullanım {fmt(k.lastUsedAt)}
                    {k.expiresAt ? ` · son geçerlilik ${fmt(k.expiresAt)}` : ""}
                  </p>
                </div>
                {!k.revokedAt && (
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => void revokeKey(k)}>
                    İptal et
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Webhook'lar"
        action={
          <Button variant="gold" size="sm" onClick={() => { setHookSecret(null); setHookOpen(true); }}>
            + Webhook
          </Button>
        }
      >
        <p className="mb-3 text-xs text-slate-500">
          Olaylar denetim izinden türetilir; her teslimat <code>X-NomosOS-Signature: sha256=HMAC(sır, gövde)</code> ile imzalanır.
          Başarısızlıkta 1 dk → 5 dk → 30 dk → 2 sa → 12 sa yeniden denenir.
        </p>
        {webhooks.length === 0 ? (
          <EmptyState message="Henüz webhook yok." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {webhooks.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="truncate text-sm font-medium text-slate-900">{h.url}</code>
                    <Badge tone={h.isActive ? "green" : "gray"}>{h.isActive ? "Aktif" : "Pasif"}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {h.description ? `${h.description} · ` : ""}
                    {h.events.length} olay · gönderildi {h.deliveries.GONDERILDI ?? 0} · bekliyor {h.deliveries.BEKLIYOR ?? 0} · başarısız {h.deliveries.BASARISIZ ?? 0}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch checked={h.isActive} label="Aktif" busy={busy} onChange={(next) => void toggleHook(h, next)} />
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void testHook(h)}>Test gönder</Button>
                  <Button size="sm" variant="secondary" onClick={() => void showDeliveries(h)}>Teslimatlar</Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => void removeHook(h)}>Sil</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={keyOpen} onClose={() => setKeyOpen(false)} title="API anahtarı oluştur">
        {plainKey ? (
          <div className="space-y-3">
            <CopyOnceField label="API anahtarı" value={plainKey} />
            <p className="text-xs text-slate-500">Bu anahtar bir daha gösterilmeyecek; entegrasyon sistemine şimdi kaydedin.</p>
            <div className="flex justify-end"><Button onClick={() => setKeyOpen(false)}>Kapat</Button></div>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Ad"><Input value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="Muhasebe entegrasyonu" /></Field>
            <Field label="Kapsamlar (yalnız okuma)">
              <div className="grid grid-cols-2 gap-2">
                {scopes.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={keyForm.scopes.includes(s.key)}
                      onChange={(e) => setKeyForm({ ...keyForm, scopes: e.target.checked ? [...keyForm.scopes, s.key] : keyForm.scopes.filter((x) => x !== s.key) })}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Son geçerlilik (isteğe bağlı)"><Input type="date" value={keyForm.expiresAt} onChange={(e) => setKeyForm({ ...keyForm, expiresAt: e.target.value })} /></Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setKeyOpen(false)}>Vazgeç</Button>
              <Button variant="gold" disabled={busy || keyForm.name.trim().length < 2 || keyForm.scopes.length === 0} onClick={() => void createKey()}>
                {busy ? "Oluşturuluyor…" : "Oluştur"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={hookOpen} onClose={() => setHookOpen(false)} title="Webhook ekle" wide>
        {hookSecret ? (
          <div className="space-y-3">
            <CopyOnceField label="İmza sırrı (HMAC-SHA256)" value={hookSecret} />
            <p className="text-xs text-slate-500">Alıcı sistem her isteğin gövdesini bu sırla imzalayıp <code>X-NomosOS-Signature</code> ile karşılaştırmalı. Sır bir daha gösterilmez.</p>
            <div className="flex justify-end"><Button onClick={() => setHookOpen(false)}>Kapat</Button></div>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Adres (HTTPS)" hint="Özel ağ ve bulut metadata adresleri reddedilir."><Input value={hookForm.url} onChange={(e) => setHookForm({ ...hookForm, url: e.target.value })} placeholder="https://…/nomosos" /></Field>
            <Field label="Açıklama (isteğe bağlı)"><Input value={hookForm.description} onChange={(e) => setHookForm({ ...hookForm, description: e.target.value })} /></Field>
            <Field label="Olaylar">
              <div className="grid gap-3 sm:grid-cols-2">
                {groups.map((g) => (
                  <div key={g}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</p>
                    {events.filter((e) => e.group === g).map((e) => (
                      <label key={e.action} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={hookForm.events.includes(e.action)}
                          onChange={(ev) => setHookForm({ ...hookForm, events: ev.target.checked ? [...hookForm.events, e.action] : hookForm.events.filter((x) => x !== e.action) })}
                        />
                        {e.label} <code className="text-[10px] text-slate-500">{e.action}</code>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setHookOpen(false)}>Vazgeç</Button>
              <Button variant="gold" disabled={busy || !hookForm.url.startsWith("https://") || hookForm.events.length === 0} onClick={() => void createHook()}>
                {busy ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!deliveriesOf} onClose={() => setDeliveriesOf(null)} title="Teslimatlar" wide>
        {deliveriesOf && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500"><code>{deliveriesOf.hook.url}</code> — son 50 teslimat</p>
            {deliveriesOf.items.length === 0 ? (
              <EmptyState message="Henüz teslimat yok." />
            ) : (
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1">Olay</th><th className="px-2 py-1">Durum</th><th className="px-2 py-1">Deneme</th><th className="px-2 py-1">Yanıt</th><th className="px-2 py-1">Zaman</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {deliveriesOf.items.map((d) => (
                      <tr key={d.id}>
                        <td className="px-2 py-1 font-mono">{d.event}</td>
                        <td className="px-2 py-1"><Badge tone={d.status === "GONDERILDI" ? "green" : d.status === "BASARISIZ" ? "danger" : "gold"}>{d.status}</Badge></td>
                        <td className="px-2 py-1">{d.attempts}{d.status === "BEKLIYOR" ? ` · sonraki ${fmt(d.nextAttemptAt)}` : ""}</td>
                        <td className="px-2 py-1">{d.lastResponseCode ?? "—"}{d.lastError ? ` · ${d.lastError}` : ""}</td>
                        <td className="px-2 py-1">{fmt(d.deliveredAt ?? d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
