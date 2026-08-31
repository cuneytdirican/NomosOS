"use client";

/**
 * Müvekkil girişi — e-posta + şifre.
 *
 * Şifre, avukatın gönderdiği DAVET BAĞLANTISI ile belirlenir (`/davet/[token]`).
 * Bu yüzden ekranda kayıt/şifremi-unuttum akışı yerine "davet bağlantınızla
 * giriş yapın" açıklaması vardır: müvekkil kendi başına hesap açamaz, portal
 * erişimini yalnızca büro verir.
 *
 * Oturum, büro ve platform oturumlarından tamamen ayrıdır
 * (`nomosos_portal_token`, JWT `aud: "portal"`).
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  errorMessage,
  getToken,
  isEndpointMissing,
  portalApi,
  setStoredUser,
  setToken,
  toStoredUser,
} from "@/lib/api";
import { EP } from "@/lib/endpoints";
import type { LoginResponse } from "@/lib/types";
import { Button, ErrorBox, Field, Input } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zaten oturumu olan müvekkili giriş ekranında tutmayalım.
  useEffect(() => {
    if (getToken()) router.replace("/");
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await portalApi<LoginResponse>(EP.auth.login, {
        method: "POST",
        body: { email: email.trim(), password },
        noAuthRedirect: true,
      });
      // Sunucu alanı `accessToken` adını taşır. Ekran `res.token` beklediği
      // için giriş HİÇ ÇALIŞMIYORDU: her denemede "Giriş yapılamadı" görünüyordu.
      if (!res?.accessToken) {
        setError("Giriş yapılamadı. Lütfen tekrar deneyin.");
        return;
      }
      setToken(res.accessToken);
      if (res.portalUser) setStoredUser(toStoredUser(res.portalUser));
      router.replace("/");
    } catch (err) {
      if (isEndpointMissing(err)) {
        setError(
          "Portal şu anda hizmet veremiyor. Kısa bir süre sonra tekrar deneyin ya da avukatınıza ulaşın.",
        );
      } else {
        // 401/403 için sunucunun mesajı gösterilir; hangi alanın yanlış olduğu
        // BİLEREK ayrıştırılmaz (hesap sayımı yapılmasını kolaylaştırırdı).
        setError(errorMessage(err, "E-posta veya şifre hatalı."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Müvekkil Portalı"
      subtitle="Dosyalarınızı, duruşmalarınızı ve ödemelerinizi tek yerden takip edin."
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="E-posta adresiniz" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ornek@sirket.com"
          />
        </Field>

        <Field label="Şifreniz" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>

        {error && <ErrorBox message={error} />}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </Button>
      </form>

      <div className="mt-7 space-y-3 rounded-xl bg-paper-alt/70 px-5 py-4 text-sm leading-relaxed text-ink-soft">
        <p className="font-medium text-ink">İlk kez mi giriyorsunuz?</p>
        <p>
          Portal hesabınızı avukatınız açar. Size gönderilen{" "}
          <strong className="font-medium text-ink">davet bağlantısına</strong> tıklayarak
          şifrenizi belirleyin, sonra bu ekrandan giriş yapın.
        </p>
        <p>
          Davet e-postası elinize ulaşmadıysa ya da bağlantının süresi dolduysa
          avukatınızdan yeni bir davet isteyin.
        </p>
      </div>
    </AuthShell>
  );
}
