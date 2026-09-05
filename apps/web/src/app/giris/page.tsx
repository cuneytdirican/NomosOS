"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, getToken, setStoredUser, setToken } from "@/lib/api";
import { Button, ErrorBox, Field, Input } from "@/components/ui";

interface LoginResponse {
  token?: string;
  accessToken?: string;
  access_token?: string;
  user?: { id?: string; fullName?: string; email?: string; role?: string };
  /** Enterprise++: 2FA kurulu → ikinci adım; büro politikası zorunlu → kurulum. */
  twoFactorRequired?: boolean;
  twoFactorSetupRequired?: boolean;
  challengeToken?: string;
  message?: string;
}

interface SetupResponse {
  setupToken: string;
  otpauthUrl: string;
  qrDataUrl: string;
  manualEntryKey: string;
  message: string;
}

export default function GirisPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2FA adımı (Enterprise++)
  const [challenge, setChallenge] = useState<{ token: string; mode: "verify" | "setup"; message: string } | null>(null);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (getToken()) router.replace("/app");
  }, [router]);

  // SSO geri dönüşü hata ile geldiyse (/giris?sso_error=…) mesajı göster.
  useEffect(() => {
    try {
      const msg = new URLSearchParams(window.location.search).get("sso_error");
      if (msg) {
        setError(msg);
        window.history.replaceState(null, "", "/giris");
      }
    } catch {
      /* SSR/eski tarayıcı: sessiz geç */
    }
  }, []);

  /** Kurumsal giriş (SSO/OIDC): e-posta alan adına göre IdP'ye yönlendirir. */
  async function handleSso() {
    setError(null);
    if (!email.includes("@")) {
      setError("Kurumsal giriş için önce e-posta adresinizi yazın.");
      return;
    }
    setSsoLoading(true);
    try {
      const res = await api<{ authorizationUrl: string }>("/auth/sso/start", { method: "POST", body: { email } });
      window.location.assign(res.authorizationUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kurumsal giriş başlatılamadı.");
      setSsoLoading(false);
    }
  }

  function finishLogin(data: LoginResponse) {
    const token = data.token ?? data.accessToken ?? data.access_token;
    if (!token) {
      setError("Sunucu geçerli bir oturum anahtarı döndürmedi.");
      return;
    }
    setToken(token);
    if (data.user) setStoredUser(data.user);
    router.replace("/app");
  }

  async function handleVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setLoading(true);
    try {
      const token = setup?.setupToken ?? challenge.token;
      const data = await api<LoginResponse>("/auth/2fa/verify", { method: "POST", body: { challengeToken: token, code } });
      finishLogin(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Doğrulama başarısız.");
      if (err instanceof ApiError && /iptal edildi|süresi dolmuş/i.test(err.message)) {
        setChallenge(null);
        setSetup(null);
        setCode("");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      if (data.twoFactorRequired && data.challengeToken) {
        setChallenge({ token: data.challengeToken, mode: "verify", message: data.message ?? "" });
        return;
      }
      if (data.twoFactorSetupRequired && data.challengeToken) {
        const s = await api<SetupResponse>("/auth/2fa/setup-with-challenge", {
          method: "POST",
          body: { challengeToken: data.challengeToken },
        });
        setSetup(s);
        setChallenge({ token: data.challengeToken, mode: "setup", message: data.message ?? "" });
        return;
      }
      finishLogin(data);
    } catch (err) {
      // İ-49: kilit durumu ayrıca bildirilir — sunucu 423/kilit mesajı döndürse
      // de "giriş yapılamadı" genel metni kilit sebebini gizliyordu.
      if (err instanceof ApiError && (err.status === 423 || err.status === 429 || /kilit/i.test(err.message))) {
        setError(
          "Hesabınız art arda başarısız denemeler nedeniyle geçici olarak KİLİTLENDİ. " +
            "Kısa bir süre sonra tekrar deneyin.",
        );
      } else {
        setError(err instanceof ApiError ? err.message : "Giriş yapılamadı. Lütfen tekrar deneyin.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <svg viewBox="0 0 32 32" className="h-10 w-10" aria-hidden="true">
              <rect width="32" height="32" rx="7" className="fill-amber-500" />
              <path
                d="M16 6l2.1 4.6 4.9.6-3.6 3.4.9 4.9L16 17l-4.3 2.5.9-4.9L9 11.2l4.9-.6L16 6z"
                className="fill-slate-900"
              />
              <rect x="8" y="23" width="16" height="2.5" rx="1.25" className="fill-slate-900" />
            </svg>
            <span className="text-2xl font-bold text-white">
              Nomos<span className="text-amber-400">OS</span>
            </span>
          </Link>
          <p className="mt-2 text-sm text-slate-500">Hukuk büronuzun işletim sistemine giriş yapın</p>
        </div>

        {challenge ? (
          <form onSubmit={handleVerify} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {challenge.mode === "setup" ? "İki adımlı doğrulamayı kurun" : "İki adımlı doğrulama"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">{challenge.message}</p>
            </div>
            {setup ? (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <img src={setup.qrDataUrl} alt="2FA QR kodu" className="mx-auto h-44 w-44" />
                <p className="text-xs text-slate-600">
                  QR okutamıyorsanız elle girin: <code className="select-all font-mono">{setup.manualEntryKey}</code>
                </p>
              </div>
            ) : null}
            <Field label="6 haneli doğrulama kodu">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                autoFocus
                required
              />
            </Field>
            {error && <ErrorBox message={error} />}
            <Button type="submit" variant="gold" className="w-full" disabled={loading || code.replace(/\s/g, "").length !== 6}>
              {loading ? "Doğrulanıyor…" : challenge.mode === "setup" ? "Kur ve giriş yap" : "Doğrula"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-xs text-slate-500 hover:text-slate-800"
              onClick={() => {
                setChallenge(null);
                setSetup(null);
                setCode("");
                setError(null);
              }}
            >
              ← Farklı hesapla giriş
            </button>
          </form>
        ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl"
        >
          <Field label="E-posta">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="avukat@buronuz.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Şifre">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </Field>

          {error && <ErrorBox message={error} />}

          <Button type="submit" variant="gold" className="w-full" disabled={loading}>
            {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
          </Button>

          {/* Enterprise++: büronun kimlik sağlayıcısıyla (OIDC) giriş. */}
          <Button type="button" variant="secondary" className="w-full" disabled={ssoLoading} onClick={() => void handleSso()}>
            {ssoLoading ? "Yönlendiriliyor…" : "Kurumsal giriş (SSO)"}
          </Button>

          {/* Demo incelemesi AYRI sayfadadır: rol seçerek gezme (Partner /
              Avukat / Sekreter / Stajyer). Demo kimlik bilgileri gerçek giriş
              ekranında durmaz (üretim derlemesinde sızdırma olmasın). */}
          <Link
            href="/demo-giris"
            className="block rounded-lg border border-dashed border-amber-400 px-4 py-3 text-center text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50"
          >
            Ürünü merak mı ettiniz? Demo&apos;yu bir rol seçerek inceleyin →
          </Link>
        </form>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link href="/" className="hover:text-amber-400">
            ← Tanıtım sayfasına dön
          </Link>
        </p>
      </div>
    </main>
  );
}
