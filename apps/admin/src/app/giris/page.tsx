"use client";

/**
 * Platform paneli girişi — tenant girişinden (apps/web /giris) tamamen ayrıdır.
 *
 * GERÇEK SUNUCU SÖZLEŞMESİ (platform-auth.controller.ts + service):
 *   1. POST /auth/login { email, password }
 *      → { twoFactorRequired: false, accessToken, user }   : giriş tamam
 *      → { twoFactorRequired: true, twoFactorSetupRequired: false,
 *           challengeToken, message }                       : 2. adım (verify)
 *      → { twoFactorRequired: true, twoFactorSetupRequired: true,
 *           challengeToken, ... }                          : kurulum + doğrulama
 *   2. POST /auth/2fa/verify { challengeToken, code }
 *      → { twoFactorRequired: false, accessToken, user }
 *   (kurulum gerekliyse önce POST /auth/2fa/setup { challengeToken } → QR/otpauth)
 *
 * DÜZELTME (denetim bulgusu F2-K-01): önceki akış TOTP'yi login gövdesine
 * `totp` alanıyla gönderiyordu — şema onu bilmez, kod YUTULUR ve challengeToken
 * hiç saklanmazdı; 2FA kurulu hiçbir hesap panele giremezdi. Bu dosya artık
 * sunucu sözleşmesini birebir uygular.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminApi,
  errorMessage,
  getToken,
  isEndpointMissing,
  setStoredUser,
  setToken,
} from "@/lib/api";
import { EP } from "@/lib/endpoints";
import type { LoginResponse } from "@/lib/types";
import { Button, EndpointMissingNotice, ErrorBox, Field, InfoBox, Input } from "@/components/ui";

export default function AdminGirisPage() {
  const router = useRouter();
  const [step, setStep] = useState<"credentials" | "totp" | "setup">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  /** Login yanıtından gelen 2FA challenge token'ı — verify ucunun girdisidir. */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  /** Kurulum gerekliyse setup ucunun döndürdüğü otpauth/QR bağlantısı. */
  const [setupUri, setSetupUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingEndpoint, setMissingEndpoint] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace("/");
  }, [router]);

  function completeLogin(data: LoginResponse): boolean {
    const token = data.accessToken ?? data.token ?? null;
    if (!token) return false;
    setToken(token);
    if (data.user) {
      setStoredUser({
        id: data.user.id,
        email: data.user.email,
        fullName: data.user.fullName,
        role: data.user.role,
      });
    }
    router.replace("/");
    return true;
  }

  /** Login yanıtı 2FA istiyorsa durumu 2. adıma taşır. */
  function handleLoginResponse(data: LoginResponse) {
    if (data.twoFactorRequired && data.challengeToken) {
      setChallengeToken(data.challengeToken);
      if (data.twoFactorSetupRequired) {
        // Kurulum tamamlanmamış hesap: önce QR, sonra doğrulama.
        setStep("setup");
        return;
      }
      setStep("totp");
      if (data.message) setError(data.message);
      return;
    }
    if (completeLogin(data)) return;
    setError("Sunucu geçerli bir oturum anahtarı döndürmedi.");
  }

  async function submitCredentials() {
    setError(null);
    setMissingEndpoint(false);
    setLoading(true);
    try {
      // Sözleşme: yalnızca email + password. TOTP BURAYA GİRMEZ.
      const data = await adminApi<LoginResponse>(EP.auth.login, {
        method: "POST",
        body: { email, password },
        noAuthRedirect: true,
      });
      handleLoginResponse(data);
    } catch (err) {
      if (isEndpointMissing(err)) {
        setMissingEndpoint(true);
        return;
      }
      setError(errorMessage(err, "Giriş yapılamadı."));
    } finally {
      setLoading(false);
    }
  }

  /** Kurulum: POST /auth/2fa/setup { challengeToken } → otpauth URI. */
  async function startSetup() {
    if (!challengeToken) return;
    setError(null);
    setLoading(true);
    try {
      const data = await adminApi<{ otpauthUrl?: string; secretEnc?: string }>(EP.auth.setup2fa, {
        method: "POST",
        body: { challengeToken },
        noAuthRedirect: true,
      });
      setSetupUri(data.otpauthUrl ?? null);
      setStep("totp");
    } catch (err) {
      setError(errorMessage(err, "2FA kurulumu başlatılamadı."));
    } finally {
      setLoading(false);
    }
  }

  /** 2. adım: POST /auth/2fa/verify { challengeToken, code } → oturum. */
  async function submitTotp() {
    setError(null);
    setMissingEndpoint(false);
    setLoading(true);
    try {
      if (!challengeToken) {
        setError("Oturum anahtarı kayboldu; baştan giriş yapın.");
        setStep("credentials");
        return;
      }
      const data = await adminApi<LoginResponse>(EP.auth.verify2fa, {
        method: "POST",
        body: { challengeToken, code: totp },
        noAuthRedirect: true,
      });
      if (completeLogin(data)) return;
      setError("Doğrulama başarılı ama oturum anahtarı alınamadı.");
    } catch (err) {
      if (isEndpointMissing(err)) {
        setMissingEndpoint(true);
        return;
      }
      setError(errorMessage(err, "Doğrulama kodu hatalı ya da süresi doldu."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-steel-950 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <svg viewBox="0 0 32 32" className="h-10 w-10" aria-hidden="true">
            <rect width="32" height="32" rx="8" className="fill-accent-600" />
            <path d="M9 22V10h2.6l6 8.2V10H20v12h-2.6l-6-8.2V22H9z" className="fill-white" />
          </svg>
          <div>
            <p className="text-xl font-bold text-steel-50">
              Nomos<span className="text-accent-400">OS</span>{" "}
              <span className="font-normal text-steel-400">Yönetim Paneli</span>
            </p>
            <p className="text-xs text-steel-500">
              Platform operasyonu · yalnız yetkili personel · tenant uygulamasından ayrı kimlik
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-steel-800 bg-steel-900 p-8 shadow-2xl">
          {step === "credentials" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitCredentials();
              }}
              className="space-y-4"
            >
              <div>
                <h1 className="text-lg font-semibold text-steel-50">Personel Girişi</h1>
                <p className="mt-1 text-sm text-steel-400">
                  Kurumsal e-posta adresinizle giriş yapın. Hesabınızda iki aşamalı doğrulama
                  tanımlıysa ikinci adımda TOTP kodu istenir.
                </p>
              </div>
              <Field label="Kurumsal e-posta" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ad.soyad@nomosos.local"
                  autoComplete="username"
                  required
                />
              </Field>
              <Field label="Şifre" required>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                />
              </Field>
              {error && <ErrorBox message={error} />}
              {missingEndpoint && (
                <EndpointMissingNotice endpoint={EP.auth.login} method="POST" what="Panel girişi" />
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Doğrulanıyor…" : "Giriş yap"}
              </Button>
            </form>
          )}

          {step === "setup" && (
            <div className="space-y-4">
              <div>
                <h1 className="text-lg font-semibold text-steel-50">
                  İki Aşamalı Doğrulama Kurulumu
                </h1>
                <p className="mt-1 text-sm text-steel-400">
                  Hesabınız iki aşamalı doğrulama zorunluluğuyla korunuyor; kurulum
                  tamamlanmamış. Kurulumu başlatın, kimlik doğrulayıcı uygulamanızla QR/kodu
                  ekleyin, sonra 6 haneli kodla doğrulayın.
                </p>
              </div>
              {error && <ErrorBox message={error} />}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setStep("credentials");
                    setChallengeToken(null);
                    setError(null);
                  }}
                >
                  Geri
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={loading || !challengeToken}
                  onClick={() => void startSetup()}
                >
                  {loading ? "Hazırlanıyor…" : "Kurulumu başlat"}
                </Button>
              </div>
            </div>
          )}

          {step === "totp" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitTotp();
              }}
              className="space-y-4"
            >
              <div>
                <h1 className="text-lg font-semibold text-steel-50">İki Aşamalı Doğrulama</h1>
                <p className="mt-1 text-sm text-steel-400">
                  Kimlik doğrulayıcı uygulamanızdaki 6 haneli kodu girin.{" "}
                  <span className="text-steel-300">{email}</span>
                </p>
              </div>
              {setupUri && (
                <div className="rounded-lg border border-steel-700 bg-steel-950 p-3">
                  <p className="text-xs font-medium text-steel-300">Kimlik doğrulayıcıya ekle:</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-accent-300">{setupUri}</p>
                </div>
              )}
              <Field label="TOTP kodu" required>
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  autoComplete="one-time-code"
                  className="text-center font-mono text-xl tracking-[0.4em]"
                  required
                  autoFocus
                />
              </Field>
              {error && <ErrorBox message={error} />}
              {missingEndpoint && (
                <EndpointMissingNotice endpoint={EP.auth.verify2fa} method="POST" what="2FA doğrulama" />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setStep("credentials");
                    setTotp("");
                    setChallengeToken(null);
                    setSetupUri(null);
                    setError(null);
                  }}
                >
                  Geri
                </Button>
                <Button type="submit" className="flex-1" disabled={loading || totp.length !== 6}>
                  {loading ? "Doğrulanıyor…" : "Doğrula ve giriş yap"}
                </Button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-4">
          <InfoBox title="Bu panel tenant uygulamasından ayrıdır">
            Panel; origin, çerez ve JWT paylaşmaz. Platform token&apos;ı{" "}
            <code className="font-mono text-xs">aud=&quot;platform&quot;</code> taşır ve{" "}
            <code className="font-mono text-xs">/api/v1</code> tenant uçlarında geçerli değildir.
            Impersonation (&quot;tenant kullanıcısı gibi giriş yap&quot;) bilinçli olarak yoktur.
          </InfoBox>
        </div>

        <p className="mt-6 text-center text-xs text-steel-600">
          Erişim IP allowlist / VPN ile sınırlandırılmalıdır. Tüm giriş denemeleri
          PlatformAuditLog&apos;a yazılır.
        </p>
      </div>
    </main>
  );
}
