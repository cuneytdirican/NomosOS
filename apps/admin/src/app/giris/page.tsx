"use client";

/**
 * Platform paneli girişi — tenant girişinden (apps/web /giris) tamamen ayrıdır.
 *
 * Akış (POST /api/admin/v1/auth/login):
 *   1. { email, password }
 *      → { token, user }                     : 2FA kapalı hesap, giriş tamam
 *      → { twoFactorRequired: true }         : 2. adıma geç
 *      → 401 + code/message "TOTP"           : 2. adıma geç
 *   2. { email, password, totp } → { token, user }
 *
 * Token localStorage("nomosos_admin_token")'a yazılır; tenant token'ıyla aynı anahtarı
 * KULLANMAZ ve JWT'nin aud="platform" olması sunucuda zorlanır.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminApi,
  ApiError,
  errorMessage,
  getToken,
  isEndpointMissing,
  setStoredUser,
  setToken,
} from "@/lib/api";
import { EP } from "@/lib/endpoints";
import type { LoginResponse } from "@/lib/types";
import { Button, EndpointMissingNotice, ErrorBox, Field, InfoBox, Input } from "@/components/ui";

/** Yanıt gövdesinden oturum anahtarını çıkarır. */
function tokenOf(data: LoginResponse | null | undefined): string | null {
  if (!data) return null;
  return data.token ?? data.accessToken ?? data.access_token ?? null;
}

function saysTwoFactorRequired(data: LoginResponse | null | undefined): boolean {
  if (!data) return false;
  return Boolean(
    data.twoFactorRequired ?? data.totpRequired ?? data.requiresTwoFactor ?? data.requiresTotp,
  );
}

/** 401/403 gövdesinde TOTP isteği var mı? (sunucu bunu hata olarak da döndürebilir) */
function errorAsksForTotp(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status !== 401 && err.status !== 403 && err.status !== 428) return false;
  const data = err.data as Record<string, unknown> | null;
  const code = typeof data?.code === "string" ? data.code : "";
  const haystack = `${code} ${err.message}`.toUpperCase();
  return (
    haystack.includes("TOTP") ||
    haystack.includes("2FA") ||
    haystack.includes("TWO_FACTOR") ||
    haystack.includes("IKI_ASAMALI")
  );
}

export default function AdminGirisPage() {
  const router = useRouter();
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingEndpoint, setMissingEndpoint] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace("/");
  }, [router]);

  function completeLogin(data: LoginResponse): boolean {
    const token = tokenOf(data);
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

  async function submit(withTotp: boolean) {
    setError(null);
    setMissingEndpoint(false);
    setLoading(true);
    try {
      const body: Record<string, string> = { email, password };
      if (withTotp) body.totp = totp;

      const data = await adminApi<LoginResponse>(EP.auth.login, {
        method: "POST",
        body,
        noAuthRedirect: true,
      });

      if (saysTwoFactorRequired(data) && !withTotp) {
        setStep("totp");
        return;
      }
      if (completeLogin(data)) return;

      // Token yok, 2FA da istenmiyor → sözleşme dışı yanıt.
      if (!withTotp) {
        setStep("totp");
        setError(
          "Sunucu oturum anahtarı döndürmedi. İki aşamalı doğrulama gerekiyorsa kodu girin.",
        );
        return;
      }
      setError("Sunucu geçerli bir oturum anahtarı döndürmedi.");
    } catch (err) {
      if (isEndpointMissing(err)) {
        setMissingEndpoint(true);
        return;
      }
      if (!withTotp && errorAsksForTotp(err)) {
        setStep("totp");
        return;
      }
      setError(errorMessage(err, "Giriş yapılamadı."));
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
          {step === "credentials" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(false);
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
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(true);
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
                <EndpointMissingNotice endpoint={EP.auth.login} method="POST" what="Panel girişi" />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setStep("credentials");
                    setTotp("");
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
