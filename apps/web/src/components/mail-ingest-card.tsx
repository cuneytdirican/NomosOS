"use client";

/**
 * Ayarlar → Entegrasyonlar → "E-posta ile belge girişi (IMAP)" kartı (Faz 7A).
 *
 * Büro, tebligat/evrak gelen posta kutusunu bağlar; 5 dakikada bir yeni iletilerin ekleri
 * belge hattına düşer. Konu/gövdede dosya numarası (2026/145) varsa o dosyaya, yoksa
 * varsayılan dosyaya, o da yoksa triyaj kuyruğuna yazılır. Parola sunucuda mühürlüdür,
 * ekrana geri gelmez.
 */

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { getMailIngest, removeMailIngest, runMailIngest, saveMailIngest, testMailIngest, type MailIngestConfigView } from "@/lib/faz7-belge";
import { RemoteSelect } from "@/components/remote-select";
import type { CaseSummary } from "@/lib/types";
import { Badge, Button, Card, ErrorBox, Field, Input, SuccessBox, Switch } from "@/components/ui";

export function MailIngestCard() {
  const [cfg, setCfg] = useState<MailIngestConfigView | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ enabled: false, host: "", port: "993", secure: true, username: "", password: "", folder: "INBOX", defaultCaseId: "" });
  const [caseLabel, setCaseLabel] = useState("");

  const load = useCallback(async () => {
    try {
      const c = await getMailIngest();
      setCfg(c);
      if (c.configured) {
        setForm((f) => ({ ...f, enabled: c.enabled, host: c.host ?? "", port: String(c.port ?? 993), secure: c.secure ?? true, username: c.username ?? "", folder: c.folder ?? "INBOX", defaultCaseId: c.defaultCaseId ?? "" }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setCfg(null);
      else setError(err instanceof ApiError ? err.message : "Posta kutusu ayarı yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveMailIngest({
        enabled: form.enabled,
        host: form.host.trim(),
        port: Number(form.port) || 993,
        secure: form.secure,
        username: form.username.trim(),
        password: form.password || null,
        folder: form.folder.trim() || "INBOX",
        defaultCaseId: form.defaultCaseId || null,
      });
      setCfg(saved);
      setForm((f) => ({ ...f, password: "" }));
      setNotice("Posta kutusu ayarı kaydedildi.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await testMailIngest();
      if (res.ok) setNotice(res.message);
      else setError(`Bağlantı başarısız: ${res.message}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await runMailIngest();
      setNotice(`${res.messages} ileti okundu; ${res.documents} belge alındı (${res.matched} dosyaya bağlı, ${res.triage} triyaj), ${res.skipped} atlandı.${res.errors.length ? ` Hata: ${res.errors[0]}` : ""}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Çekim yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Posta kutusu bağlantısı kaldırılsın mı? Alınmış belgeler silinmez.")) return;
    setBusy(true);
    try {
      await removeMailIngest();
      setCfg({ configured: false, enabled: false });
      setForm({ enabled: false, host: "", port: "993", secure: true, username: "", password: "", folder: "INBOX", defaultCaseId: "" });
      setNotice("Bağlantı kaldırıldı.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kaldırılamadı.");
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) return null;

  return (
    <Card
      title="E-posta ile belge girişi (IMAP)"
      action={
        cfg?.configured ? (
          <div className="flex items-center gap-2">
            <Badge tone={cfg.enabled ? "green" : "gray"}>{cfg.enabled ? "Açık" : "Kapalı"}</Badge>
            {cfg.lastError ? <Badge tone="red">Son çekim hatalı</Badge> : cfg.lastSyncAt ? <Badge tone="blue">Son çekim {new Date(cfg.lastSyncAt).toLocaleString("tr-TR")}</Badge> : null}
          </div>
        ) : undefined
      }
    >
      <p className="mb-4 text-xs leading-5 text-slate-500">
        Tebligat/evrak gelen posta kutusunu bağlayın; yeni iletilerin ekleri 5 dakikada bir belge hattına alınır. Konu ya da
        gövdede <span className="font-mono">2026/145</span> biçiminde dosya numarası varsa o dosyaya, yoksa aşağıdaki varsayılan
        dosyaya, o da yoksa triyaj kuyruğuna düşer. Aynı numaralı birden çok dosya varsa tahmin edilmez, triyaja gider.
      </p>
      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}
      {cfg?.lastSummary && <p className="mb-3 text-xs text-slate-600">Son çekim: {cfg.lastSummary}</p>}
      {cfg?.lastError && <p className="mb-3 text-xs text-red-700">Son hata: {cfg.lastError}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="IMAP sunucusu">
          <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="imap.buro.com.tr" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port">
            <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="TLS">
            <div className="pt-2">
              <Switch checked={form.secure} onChange={(v) => setForm({ ...form, secure: v })} label={form.secure ? "Açık (993)" : "Kapalı"} />
            </div>
          </Field>
        </div>
        <Field label="Kullanıcı adı / e-posta">
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Parola" hint={cfg?.configured ? "Boş bırakılırsa mevcut parola korunur." : "Uygulama parolası önerilir."}>
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </Field>
        <Field label="Klasör">
          <Input value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} />
        </Field>
        <Field label="Varsayılan dosya (isteğe bağlı)" hint="Numara eşleşmeyen ekler bu dosyaya bağlanır.">
          <RemoteSelect<CaseSummary>
            path="/cases"
            value={form.defaultCaseId}
            selectedLabel={caseLabel}
            onChange={(id, opt) => {
              setForm({ ...form, defaultCaseId: id });
              setCaseLabel(opt?.label ?? "");
            }}
            toOption={(c) => ({ id: c.id, label: `${c.fileNumber ? `${c.fileNumber} — ` : ""}${c.title}` })}
            placeholder="Dosya ara…"
            emptyMessage="Eşleşen dosya yok."
            ariaLabel="Varsayılan dosya"
          />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Otomatik çekim açık" />
        <div className="ml-auto flex flex-wrap gap-2">
          {cfg?.configured && (
            <>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void test()}>
                Bağlantıyı test et
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run()}>
                Şimdi çek
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
                Kaldır
              </Button>
            </>
          )}
          <Button variant="gold" size="sm" disabled={busy || !form.host.trim() || !form.username.trim() || (!cfg?.configured && !form.password)} onClick={() => void save()}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
