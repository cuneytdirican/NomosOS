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
}

export default function GirisPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getToken()) router.replace("/app");
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      const token = data.token ?? data.accessToken ?? data.access_token;
      if (!token) {
        setError("Sunucu geçerli bir oturum anahtarı döndürmedi.");
        return;
      }
      setToken(token);
      if (data.user) setStoredUser(data.user);
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Giriş yapılamadı. Lütfen tekrar deneyin.");
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

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link href="/" className="hover:text-amber-400">
            ← Tanıtım sayfasına dön
          </Link>
        </p>
      </div>
    </main>
  );
}
