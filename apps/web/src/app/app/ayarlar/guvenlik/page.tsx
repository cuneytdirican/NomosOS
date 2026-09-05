"use client";

/**
 * Ayarlar → Güvenlik (Enterprise++).
 *
 *  1. İki adımlı doğrulama (TOTP): kurulum (parola + QR + kod), kapatma
 *     (parola + kod). Büro politikası zorunluysa kapatma kilitlidir.
 *  2. Parola değiştirme (K-03 ucu; arayüzü buradadır).
 *  3. Tüm oturumları kapat (sunucu tarafı çıkış).
 *  4. BÜRO GÜVENLİK POLİTİKASI (yalnız ADMIN düzenler, ADMIN/PARTNER görür):
 *     2FA zorunluluğu, oturum ömrü (1-24 sa), 2FA yaygınlığı.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, clearToken } from "@/lib/api";
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Spinner, SuccessBox, Switch } from "@/components/ui";
import { SessionsCard } from "./sessions-card";

interface Me {
  id: string;
  email: string;
  fullName: string;
  role: string;
  twoFactorEnabled?: boolean;
  tenant?: { id: string; name: string; require2fa?: boolean; sessionMaxHours?: number | null } | null;
}

interface SetupResponse {
  setupToken: string;
  qrDataUrl: string;
  manualEntryKey: string;
  message: string;
}

interface Policy {
  require2fa: boolean;
  sessionMaxHours: number | null;
  users: { total: number; withTwoFactor: number };
  canEdit: boolean;
}

export default function GuvenlikPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 2FA kurulum/kapatma
  const [setupPassword, setSetupPassword] = useState("");
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");

  // parola
  const [pw, setPw] = useState({ current: "", next: "", again: "" });

  // politika
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await api<Me>("/me");
      setMe(m);
      if (m.role === "ADMIN" || m.role === "PARTNER") {
        setPolicy(await api<Policy>("/security/policy").catch(() => null));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Güvenlik bilgileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startSetup() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setSetup(await api<SetupResponse>("/auth/2fa/setup", { method: "POST", body: { currentPassword: setupPassword } }));
      setSetupPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kurulum başlatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    if (!setup) return;
    setBusy(true);
    setError(null);
    try {
      await api("/auth/2fa/verify", { method: "POST", body: { challengeToken: setup.setupToken, code: setupCode } });
      setSetup(null);
      setSetupCode("");
      setNotice("İki adımlı doğrulama etkinleştirildi. Bundan sonra her girişte doğrulama kodu istenecek.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kod doğrulanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/auth/2fa/disable", { method: "POST", body: { currentPassword: disablePassword, code: disableCode } });
      setDisablePassword("");
      setDisableCode("");
      setNotice("İki adımlı doğrulama kapatıldı.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kapatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (pw.next !== pw.again) {
      setError("Yeni parola tekrarı eşleşmiyor.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ message: string }>("/auth/change-password", {
        method: "POST",
        body: { currentPassword: pw.current, newPassword: pw.next },
      });
      setPw({ current: "", next: "", again: "" });
      // Sunucu tüm oturumları düşürür — kullanıcı yeniden giriş yapar.
      clearToken();
      window.alert(res.message);
      router.replace("/giris");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Parola değiştirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function logoutAll() {
    if (!window.confirm("Tüm cihazlardaki oturumlarınız kapatılacak. Devam edilsin mi?")) return;
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      clearToken();
      router.replace("/giris");
    }
  }

  async function savePolicy(patch: { require2fa?: boolean; sessionMaxHours?: number | null }) {
    setPolicyBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/security/policy", { method: "PATCH", body: patch });
      setNotice(
        patch.require2fa === true
          ? "2FA zorunluluğu açıldı: 2FA'sı olmayan kullanıcılar bir sonraki girişte kurulum yapacak."
          : "Güvenlik politikası güncellendi.",
      );
      setPolicy(await api<Policy>("/security/policy"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Politika güncellenemedi.");
    } finally {
      setPolicyBusy(false);
    }
  }

  if (loading) return <Spinner label="Güvenlik ayarları yükleniyor…" />;

  const twoFactorOn = me?.twoFactorEnabled === true;
  const require2fa = me?.tenant?.require2fa === true;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Güvenlik</h1>
        <p className="mt-1 text-sm text-slate-500">
          Hesabınızın iki adımlı doğrulaması, parolanız ve oturumlarınız; büro yöneticileri için güvenlik politikası.
        </p>
      </div>

      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}

      <Card title="İki adımlı doğrulama (2FA)">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={twoFactorOn ? "green" : "gray"}>{twoFactorOn ? "Etkin" : "Kurulu değil"}</Badge>
            {require2fa && <Badge tone="navy">Büro politikası: zorunlu</Badge>}
            <span className="text-xs text-slate-500">
              Google/Microsoft Authenticator, 1Password vb. uygulamalarla (TOTP). Gizli anahtar şifreli saklanır.
            </span>
          </div>

          {!twoFactorOn && !setup && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <Field label="Mevcut parolanız" hint="Çalınmış bir oturumun 2FA'yı kendisi kurmasını engeller.">
                  <Input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} autoComplete="current-password" />
                </Field>
              </div>
              <Button variant="gold" disabled={busy || setupPassword.length === 0} onClick={() => void startSetup()}>
                Kurulumu başlat
              </Button>
            </div>
          )}

          {setup && (
            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <img src={setup.qrDataUrl} alt="2FA QR kodu" className="mx-auto h-44 w-44" />
                <p className="mt-1 text-[11px] text-slate-500">
                  Elle giriş: <code className="select-all font-mono">{setup.manualEntryKey}</code>
                </p>
              </div>
              <div className="space-y-3">
                <p className="text-sm text-slate-600">{setup.message}</p>
                <div className="w-56">
                  <Field label="Uygulamadaki 6 haneli kod">
                    <Input value={setupCode} onChange={(e) => setSetupCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Button variant="gold" disabled={busy || setupCode.replace(/\s/g, "").length !== 6} onClick={() => void confirmSetup()}>
                    Doğrula ve etkinleştir
                  </Button>
                  <Button variant="secondary" onClick={() => { setSetup(null); setSetupCode(""); }}>
                    Vazgeç
                  </Button>
                </div>
              </div>
            </div>
          )}

          {twoFactorOn && (
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="mb-2 text-sm font-medium text-slate-800">Kapatma</p>
              {require2fa ? (
                <p className="text-sm text-slate-600">
                  Büronuzun güvenlik politikası 2FA'yı zorunlu kılıyor; kapatılamaz. Cihaz değişiminde büro yöneticinizden
                  &quot;2FA Sıfırla&quot; isteyin (Ayarlar → Kullanıcılar).
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-64">
                    <Field label="Mevcut parola">
                      <Input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} autoComplete="current-password" />
                    </Field>
                  </div>
                  <div className="w-40">
                    <Field label="Güncel kod">
                      <Input value={disableCode} onChange={(e) => setDisableCode(e.target.value)} inputMode="numeric" placeholder="123 456" />
                    </Field>
                  </div>
                  <Button variant="danger" disabled={busy || !disablePassword || disableCode.replace(/\s/g, "").length !== 6} onClick={() => void disable()}>
                    2FA&apos;yı kapat
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Parola">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Mevcut parola">
            <Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          </Field>
          <Field label="Yeni parola" hint="En az 10 karakter.">
            <Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Yeni parola (tekrar)">
            <Input type="password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Parola değişince güvenlik gereği bu oturum dâhil tüm oturumlarınız kapanır.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy || !pw.current || pw.next.length < 10} onClick={() => void changePassword()}>
            Parolayı değiştir
          </Button>
          <Button variant="secondary" onClick={() => void logoutAll()}>
            Tüm cihazlarda oturumu kapat
          </Button>
        </div>
      </Card>

      {/* Enterprise++: cihaz bazlı oturum listesi — tek cihazı kapatma. */}
      <SessionsCard />

      {policy && (
        <Card title="Büro güvenlik politikası">
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              {policy.users.withTwoFactor}/{policy.users.total} aktif kullanıcıda 2FA kurulu.
              {!policy.canEdit && " Politikayı yalnız büro yöneticisi (ADMIN) değiştirebilir."}
            </p>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
              <div>
                <p className="text-sm font-medium text-slate-800">İki adımlı doğrulama zorunlu</p>
                <p className="text-xs text-slate-500">
                  Açıkken 2FA'sı olmayan her kullanıcı bir sonraki girişte kurulum yapmadan içeri giremez; kullanıcılar 2FA'yı kapatamaz.
                </p>
              </div>
              <Switch
                checked={policy.require2fa}
                disabled={!policy.canEdit}
                busy={policyBusy}
                label="2FA zorunluluğu"
                onChange={(next) => {
                  if (next && !window.confirm("2FA zorunluluğu açılacak: 2FA'sı olmayan kullanıcılar bir sonraki girişte kurulum yapacak. Devam?")) return;
                  void savePolicy({ require2fa: next });
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
              <div>
                <p className="text-sm font-medium text-slate-800">Oturum ömrü</p>
                <p className="text-xs text-slate-500">Yeni girişlerde geçerli; varsayılan 12 saat. Kısa süre ortak bilgisayarlarda riski azaltır.</p>
              </div>
              <div className="w-40">
                <Select
                  value={String(policy.sessionMaxHours ?? "")}
                  disabled={!policy.canEdit || policyBusy}
                  onChange={(e) => void savePolicy({ sessionMaxHours: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Varsayılan (12 sa)</option>
                  {[1, 2, 4, 8, 12, 24].map((h) => (
                    <option key={h} value={h}>
                      {h} saat
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
