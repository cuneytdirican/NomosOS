"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorBox, Field, Input, SuccessBox } from "@/components/ui";

/** Faz 2 — e-postadaki bağlantı: `?token=…` ile yeni parola belirleme. */
function SifreSifirlaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError("Parolalar eşleşmiyor.");
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ message: string }>("/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: password },
      });
      setDone(res.message);
      setTimeout(() => router.push("/giris"), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Parola güncellenemedi.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl">
        <ErrorBox message="Sıfırlama bağlantısı eksik. E-postadaki bağlantıyı kullanın ya da yeniden isteyin." />
        <Link href="/sifre-unuttum" className="block text-center text-sm text-amber-700 hover:underline">
          Yeni bağlantı iste
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl">
      {done ? (
        <SuccessBox message={`${done} Giriş sayfasına yönlendiriliyorsunuz…`} />
      ) : (
        <>
          <Field label="Yeni parola" hint="En az 10 karakter; harf ve rakam içermeli.">
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Yeni parola (tekrar)">
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" className="w-full" disabled={loading || password.length < 10}>
            {loading ? "Güncelleniyor…" : "Parolayı güncelle"}
          </Button>
          <p className="text-xs text-slate-500">Güvenlik gereği açık tüm oturumlarınız düşürülür.</p>
        </>
      )}
    </form>
  );
}

export default function SifreSifirlaPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="text-2xl font-bold text-white">
            Nomos<span className="text-amber-400">OS</span>
          </Link>
          <p className="mt-2 text-sm text-slate-500">Yeni parolanızı belirleyin</p>
        </div>
        <Suspense fallback={null}>
          <SifreSifirlaForm />
        </Suspense>
      </div>
    </div>
  );
}
