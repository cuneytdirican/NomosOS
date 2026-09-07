"use client";

/**
 * MÜVEKKİL DEMO GİRİŞİ — gerçek giriş (/giris) sayfasından AYRIDIR.
 *
 * Tanıtım sitesindeki (nomosos) "Demo Giriş → Müvekkil" kartı buraya yönlendirir.
 * Sayfa açılınca seed'deki demo müvekkil hesabıyla (portal@demo.nomosos.local)
 * OTOMATİK giriş yapar; ziyaretçi tek tıkla müvekkil portalını gerçek oturumla
 * dener. Sahte oturum yok — sunucu gerçek portal kimliğini (aud: "portal") verir.
 *
 * Üretimde kapatma: NEXT_PUBLIC_DISABLE_DEMO=1 → sayfa /giris'e yönlenir.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage, getToken, portalApi, setStoredUser, setToken, toStoredUser } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import type { LoginResponse } from "@/lib/types";
import { Button, ErrorBox } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";

const DEMO_EMAIL = "portal@demo.nomosos.local";
const DEMO_PASSWORD = "Demo1234!";

export default function MuvekkilDemoGirisPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const disabled = process.env.NEXT_PUBLIC_DISABLE_DEMO === "1";

  const login = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await portalApi<LoginResponse>(EP.auth.login, {
        method: "POST",
        body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
        noAuthRedirect: true,
      });
      if (!res?.accessToken) {
        setError("Demo girişi yapılamadı. Demo ortamı çalışıyor mu kontrol edin.");
        return;
      }
      setToken(res.accessToken);
      if (res.portalUser) setStoredUser(toStoredUser(res.portalUser));
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err, "Demo girişi yapılamadı. Lütfen tekrar deneyin."));
    } finally {
      setBusy(false);
    }
  }, [router]);

  useEffect(() => {
    if (disabled) {
      router.replace("/giris");
      return;
    }
    if (getToken()) {
      router.replace("/");
      return;
    }
    void login();
  }, [disabled, router, login]);

  if (disabled) return null;

  return (
    <AuthShell
      title="Müvekkil Portalı — Demo"
      subtitle="Örnek müvekkil (ABC Holding A.Ş.) hesabıyla portalı gerçek oturumla deneyin."
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-600">
          {busy
            ? "Demo müvekkil hesabıyla giriş yapılıyor…"
            : "Girişe hazır. Aşağıdaki düğmeyle müvekkil portalına demo girişi yapabilirsiniz."}
        </p>
        {error && <ErrorBox message={error} onRetry={() => void login()} />}
        <Button type="button" onClick={() => void login()} disabled={busy} className="w-full">
          {busy ? "Giriş yapılıyor…" : "Müvekkil olarak demo girişi"}
        </Button>
        <p className="text-center text-xs text-slate-500">
          Demo hesabı: {DEMO_EMAIL} · Bu hesap yalnızca demo ortamında tanımlıdır.
        </p>
      </div>
    </AuthShell>
  );
}
