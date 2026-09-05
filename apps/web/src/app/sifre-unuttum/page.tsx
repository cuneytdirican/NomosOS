"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorBox, Field, Input, SuccessBox } from "@/components/ui";

/**
 * Faz 2 — büro kullanıcısı parola sıfırlama isteği. Yanıt her zaman jeneriktir
 * (hesabın varlığı sızdırılmaz); bağlantı e-postayla gelir ve 30 dk geçerlidir.
 */
export default function SifreUnuttumPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ message: string }>("/auth/forgot-password", { method: "POST", body: { email } });
      setDone(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İstek gönderilemedi. Daha sonra tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="text-2xl font-bold text-white">
            Nomos<span className="text-amber-400">OS</span>
          </Link>
          <p className="mt-2 text-sm text-slate-500">Parolanızı sıfırlamak için e-posta adresinizi girin</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl">
          {done ? (
            <SuccessBox message={done} />
          ) : (
            <>
              <Field label="E-posta">
                <Input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="avukat@buro.av.tr"
                />
              </Field>
              {error && <ErrorBox message={error} />}
              <Button type="submit" className="w-full" disabled={loading || !email}>
                {loading ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}
              </Button>
              <p className="text-xs text-slate-500">
                Bağlantı 30 dakika geçerlidir ve bir kez kullanılabilir. E-posta ulaşmazsa büro yöneticinizden
                parolanızı sıfırlamasını isteyebilirsiniz.
              </p>
            </>
          )}
          <p className="text-center text-sm">
            <Link href="/giris" className="text-amber-700 hover:underline">
              ← Girişe dön
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
