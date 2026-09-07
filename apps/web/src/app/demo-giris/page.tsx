"use client";

/**
 * DEMO GİRİŞ SAYFASI — gerçek giriş sayfasından (/giris) AYRIDIR.
 *
 * Amaç: NomosOS'u merak eden kullanıcının ürünü ROLLERE GÖRE incelemesi.
 * Her kart, seed'de tohumlanmış demo hesabıyla GERÇEK giriş akışını
 * (/auth/login) kullanır — sahte oturum yok: hangi rolle girilirse
 * sunucu o rolün yetki kapılarını uygular, menü o role göre süzülür.
 *
 * Rollere farklı deneyim: menü ve erişim sunucudaki rol kümeleriyle
 * hizalıdır (finance-access.ts, ROLE_SETS.ONAY). Örn. Stajyer Finans ve
 * Faturalar'ı görmez; Avukat AI Sağlayıcı'yı görmez.
 *
 * Üretimde kapatma: NEXT_PUBLIC_DISABLE_DEMO=1 ortam değişkeni sayfayı
 * kapatır ve /giris'e yönlendirir (demo hesapları üretimde tohumlanmaz).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, getToken, setStoredUser, setToken, setDemoRole } from "@/lib/api";

interface LoginResponse {
  token?: string;
  accessToken?: string;
  access_token?: string;
  user?: { id?: string; fullName?: string; email?: string; role?: string };
}

/** Seed'de tohumlanan demo hesapları (packages/db/src/seed.ts). */
const DEMO_ACCOUNTS = [
  {
    role: "PARTNER",
    email: "partner@demo.nomosos.local",
    title: "Ortak (Partner)",
    desc: "Tam yetki: onay akışları, finans, AI sağlayıcı yönetimi dahil her şey.",
    canSee: "Tüm menü · süre/kredi onayları · AI sağlayıcı ayarları",
  },
  {
    role: "AVUKAT",
    email: "avukat@demo.nomosos.local",
    title: "Avukat",
    desc: "Hukuki tasarruf (dosya durumu, süre, delil) + finans; yönetim uçları kapalı.",
    canSee: "Tüm menü (AI Sağlayıcı hariç)",
  },
  {
    role: "SEKRETER",
    email: "sekreter@demo.nomosos.local",
    title: "Sekreter",
    desc: "Kayıt ve iletişim operasyonu + tahsilat; hukuki tasarruf kapalı.",
    canSee: "Müvekkil · dosya · duruşma · iletişim · finans (yazma sınırlı)",
  },
  {
    role: "STAJYER",
    email: "stajyer@demo.nomosos.local",
    title: "Stajyer",
    desc: "En kısıtlı görünüm: izleme ve görev; finans ve onay akışları kapalı.",
    canSee: "Menünün büyük bölümü (Finans · Faturalar · Zaman Kaydı yok)",
  },
] as const;

const DEMO_PASSWORD = "Demo1234!";

/** Müvekkil portalı AYRI bir uygulamadır (ayrı subdomain/kimlik); demo girişi oraya yönlenir. */
const PORTAL_DEMO_URL =
  (process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3003").replace(/\/+$/, "") + "/demo-giris";

export default function DemoGirisPage() {
  const router = useRouter();
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = process.env.NEXT_PUBLIC_DISABLE_DEMO === "1";

  useEffect(() => {
    if (disabled) {
      router.replace("/giris");
      return;
    }
    if (getToken()) router.replace("/app");
  }, [router, disabled]);

  async function loginAs(email: string, role: string) {
    setBusyRole(role);
    setError(null);
    try {
      const data = await api<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password: DEMO_PASSWORD },
      });
      const token = data.token ?? data.accessToken ?? data.access_token;
      if (!token) {
        setError("Sunucu geçerli bir oturum anahtarı döndürmedi.");
        return;
      }
      setToken(token);
      if (data.user) setStoredUser(data.user);
      // Demo bayrağı yalnız GÖSTERİM içindir; yetkiyi sunucu belirler.
      setDemoRole(data.user?.role ?? role);
      router.replace("/app");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Demo girişi yapılamadı. Demo ortamı çalışıyor mu kontrol edin.",
      );
    } finally {
      setBusyRole(null);
    }
  }

  if (disabled) return null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-3xl">
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
          <h1 className="mt-4 text-xl font-semibold text-white">
            Demo&apos;yu bir rol seçerek inceleyin
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-300">
            Gerçek bir büro verisi üzerinde gezinin. Menü, yetki kapıları ve onay akışları
            seçtiğiniz role göre değişir — gördüğünüz eksiklikler roller arası yetki
            ayrımıdır, hata değil.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.role}
              type="button"
              disabled={busyRole !== null}
              onClick={() => void loginAs(account.email, account.role)}
              className="group flex flex-col rounded-2xl border border-slate-700 bg-slate-800 p-5 text-left transition-colors hover:border-amber-500 hover:bg-slate-700 disabled:opacity-60"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{account.title}</span>
                <span className="rounded-full bg-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
                  {busyRole === account.role ? "Giriş yapılıyor…" : "Demo girişi"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{account.desc}</p>
              <p className="mt-3 border-t border-slate-700 pt-2 text-[11px] text-slate-300">
                <span className="font-semibold text-slate-300">Görür:</span> {account.canSee}
              </p>
              <p className="mt-1 text-[11px] text-slate-300">{account.email}</p>
            </button>
          ))}
        </div>

        {/* Müvekkil (Portal) demosu — büro rolleri dışında AYRI uygulama. */}
        <div className="mt-4">
          <a
            href={PORTAL_DEMO_URL}
            className="group flex flex-col rounded-2xl border border-teal-700 bg-teal-950/40 p-5 text-left transition-colors hover:border-teal-400 hover:bg-teal-900/40 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">Müvekkil (Portal)</span>
                <span className="rounded-full bg-teal-800 px-2.5 py-0.5 text-[11px] font-medium text-teal-200">
                  Ayrı portal · demo girişi
                </span>
              </div>
              <p className="mt-2 max-w-xl text-sm text-slate-300">
                Müvekkilin gözünden portal: dosya durumu, duruşmalar, yapılacaklar, belge yükleme,
                rıza kayıtları ve ödemeler. Örnek müvekkil hesabıyla otomatik açılır.
              </p>
            </div>
            <span className="mt-3 inline-flex shrink-0 items-center gap-1 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-teal-950 transition-colors group-hover:bg-teal-400 sm:mt-0">
              Müvekkil demosunu aç
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </span>
          </a>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </p>
        )}

        <p className="mt-6 text-center text-xs text-slate-300">
          Kendi hesabınızla girmek için{" "}
          <Link href="/giris" className="text-amber-400 hover:underline">
            gerçek giriş sayfasını
          </Link>{" "}
          kullanın. Demo hesapları yalnızca demo ortamında tohumlanır.
        </p>
      </div>
    </main>
  );
}
