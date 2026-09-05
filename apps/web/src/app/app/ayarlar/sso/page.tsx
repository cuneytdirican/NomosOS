"use client";

/**
 * Ayarlar → Kurumsal Giriş (SSO / OIDC) — Enterprise++.
 *
 * Büro kendi kimlik sağlayıcısını tanımlar (Entra ID, Google Workspace, Okta,
 * Keycloak…). Yalnız ADMIN kaydeder; PARTNER görüntüler ve bağlantı testi
 * yapabilir. İstemci sırrı bir kez girilir, geri okunmaz.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, DataRow, ErrorBox, Field, Input, Select, Spinner, SuccessBox, Switch } from "@/components/ui";

interface SsoConfig {
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  clientSecretSet: boolean;
  emailDomain: string | null;
  enforced: boolean;
  autoProvision: boolean;
  defaultRole: string;
  callbackUrl: string;
  linkedUsers: number;
  roles: string[];
}

const ROLE_LABELS: Record<string, string> = { PARTNER: "Ortak", AVUKAT: "Avukat", STAJYER: "Stajyer", SEKRETER: "Sekreter" };

export default function SsoPage() {
  const [cfg, setCfg] = useState<SsoConfig | null>(null);
  const [form, setForm] = useState({ issuer: "", clientId: "", clientSecret: "", emailDomain: "", defaultRole: "STAJYER" });
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<{ issuer: string; authorizationEndpoint: string; tokenEndpoint: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await api<SsoConfig>("/security/sso");
      setCfg(c);
      setForm({ issuer: c.issuer ?? "", clientId: c.clientId ?? "", clientSecret: "", emailDomain: c.emailDomain ?? "", defaultRole: c.defaultRole });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "SSO yapılandırması yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(extra: Partial<{ enabled: boolean; enforced: boolean; autoProvision: boolean }> = {}) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        issuer: form.issuer.trim() || null,
        clientId: form.clientId.trim() || null,
        emailDomain: form.emailDomain.trim() || null,
        defaultRole: form.defaultRole,
        ...extra,
      };
      if (form.clientSecret.trim()) body.clientSecret = form.clientSecret.trim();
      const c = await api<SsoConfig>("/security/sso", { method: "PUT", body });
      setCfg(c);
      setForm((f) => ({ ...f, clientSecret: "" }));
      setNotice("SSO yapılandırması kaydedildi.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      setTest(await api("/security/sso/test", { method: "POST" }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Bağlantı testi başarısız.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="SSO yapılandırması yükleniyor…" />;
  if (forbidden) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Kurumsal Giriş (SSO)</h1>
        <Card>
          <p className="p-5 text-sm text-slate-600">
            SSO yapılandırması <strong>Ortak</strong> ve <strong>Yönetici</strong> rollerine açıktır.
          </p>
        </Card>
      </div>
    );
  }
  if (!cfg) return error ? <ErrorBox message={error} /> : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Kurumsal Giriş (SSO)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kullanıcılar büronuzun kimlik sağlayıcısıyla (Microsoft Entra ID, Google Workspace, Okta, Keycloak…) giriş yapar. OpenID Connect.
        </p>
      </div>

      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}

      <Card title="Durum">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={cfg.enabled ? "green" : "gray"}>{cfg.enabled ? "SSO açık" : "SSO kapalı"}</Badge>
          {cfg.enforced && <Badge tone="danger">Parola girişi kapalı (ADMIN hariç)</Badge>}
          <span className="text-xs text-slate-500">{cfg.linkedUsers} kullanıcı kurumsal kimliğe bağlı</span>
        </div>
        <div className="mt-4 space-y-1">
          <DataRow label="Geri dönüş adresi (IdP'ye kaydedin)">
            <code className="select-all break-all text-xs">{cfg.callbackUrl}</code>
          </DataRow>
        </div>
      </Card>

      <Card title="Kimlik sağlayıcı">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issuer (discovery kökü)" hint="Örn. https://login.microsoftonline.com/<tenant>/v2.0 — /.well-known/openid-configuration buradan çekilir.">
            <Input value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="E-posta alan adı" hint="Girişte büronuzu bulur; yalnız bu alan adındaki hesaplar kabul edilir.">
            <Input value={form.emailDomain} onChange={(e) => setForm({ ...form, emailDomain: e.target.value })} placeholder="ornekhukuk.com" />
          </Field>
          <Field label="İstemci kimliği (client id)">
            <Input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
          </Field>
          <Field label="İstemci sırrı (client secret)" hint={cfg.clientSecretSet ? "Kayıtlı — değiştirmek için yeni sır girin." : "Henüz girilmedi."}>
            <Input type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} placeholder={cfg.clientSecretSet ? "••••••••" : ""} autoComplete="new-password" />
          </Field>
          <Field label="Otomatik açılan kullanıcının rolü">
            <Select value={form.defaultRole} onChange={(e) => setForm({ ...form, defaultRole: e.target.value })}>
              {cfg.roles.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="gold" disabled={busy} onClick={() => void save()}>{busy ? "Kaydediliyor…" : "Kaydet"}</Button>
          <Button variant="secondary" disabled={busy || !form.issuer} onClick={() => void runTest()}>Bağlantıyı sına</Button>
        </div>
        {test && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <p className="font-semibold">Discovery başarılı</p>
            <p>issuer: <code>{test.issuer}</code></p>
            <p>authorization: <code className="break-all">{test.authorizationEndpoint}</code></p>
            <p>token: <code className="break-all">{test.tokenEndpoint}</code></p>
          </div>
        )}
      </Card>

      <Card title="Politika">
        <ul className="divide-y divide-slate-100">
          <li className="flex items-center justify-between gap-4 py-3 first:pt-0">
            <div>
              <p className="text-sm font-medium text-slate-900">SSO açık</p>
              <p className="text-xs text-slate-500">Giriş sayfasındaki "Kurumsal giriş" bu büronun alan adı için çalışır.</p>
            </div>
            <Switch checked={cfg.enabled} label="SSO açık" busy={busy} onChange={(v) => void save({ enabled: v })} />
          </li>
          <li className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-900">Otomatik kullanıcı açma</p>
              <p className="text-xs text-slate-500">Alan adı eşleşen ama NomosOS hesabı olmayan kişi ilk girişte yukarıdaki rolle açılır.</p>
            </div>
            <Switch checked={cfg.autoProvision} label="Otomatik kullanıcı açma" busy={busy} onChange={(v) => void save({ autoProvision: v })} />
          </li>
          <li className="flex items-center justify-between gap-4 py-3 last:pb-0">
            <div>
              <p className="text-sm font-medium text-slate-900">Parola girişini kapat (SSO zorunlu)</p>
              <p className="text-xs text-slate-500">
                Yönetici (ADMIN) hesapları parola ile girmeye devam eder — kimlik sağlayıcı arızasında erişim kaybolmasın.
              </p>
            </div>
            <Switch checked={cfg.enforced} label="SSO zorunlu" busy={busy || !cfg.enabled} onChange={(v) => void save({ enforced: v })} />
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          SSO ile giriş, iki adımlı doğrulama (TOTP) adımını atlar — çok faktörlü doğrulama kimlik sağlayıcının sorumluluğundadır.
        </p>
      </Card>
    </div>
  );
}
