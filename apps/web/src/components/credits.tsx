"use client";

/**
 * Kredi arayüz bileşenleri (Modül 26 §Arayüz).
 *
 * TASARIM İLKESİ: kredi asla ENGELLEYİCİ görünmez, AÇIKLAYICI görünür.
 * Bakiye bittiğinde kullanıcıya "yapamazsın" değil, "şunu yapabilirsin ve
 * şunlar etkilenmedi" denir. Süre, duruşma, dosya ve belge akışlarının
 * çalıştığını yazan cümle her kartta durur — avukatın panikleyeceği tek şey
 * süre kaçırmaktır, kredi değil.
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CREDITS_CHANGED_EVENT,
  CREDIT_ERROR_EVENT,
  asInsufficientCredits,
  asRequestTooLarge,
  fetchCosts,
  fetchWallet,
  meterTone,
  type CreditCost,
  type CreditWalletResponse,
} from "@/lib/credits";

// ---------------------------------------------------------------------------
// Cüzdan kancası — üst çubuk ve AI düğmeleri aynı veriyi paylaşır.
// ---------------------------------------------------------------------------

export function useWallet(): {
  wallet: CreditWalletResponse | null;
  loading: boolean;
  reload: () => void;
} {
  const [wallet, setWallet] = useState<CreditWalletResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void fetchWallet().then((w) => {
      if (!alive) return;
      setWallet(w);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [nonce]);

  useEffect(() => {
    const handler = () => reload();
    window.addEventListener(CREDITS_CHANGED_EVENT, handler);
    // Kredi tüketen bir işlem her yerde olabilir; iki dakikada bir tazelenir.
    const timer = window.setInterval(handler, 120_000);
    return () => {
      window.removeEventListener(CREDITS_CHANGED_EVENT, handler);
      window.clearInterval(timer);
    };
  }, [reload]);

  return { wallet, loading, reload };
}

/** Fiyat listesi — AI düğmelerindeki "· 20 kredi" etiketinin kaynağı. */
export function useCreditCosts(): { costs: Map<string, CreditCost>; tavan: number } {
  const [costs, setCosts] = useState<Map<string, CreditCost>>(new Map());
  const [tavan, setTavan] = useState(50);

  useEffect(() => {
    let alive = true;
    void fetchCosts().then((res) => {
      if (!alive || !res) return;
      setCosts(new Map(res.items.map((c) => [c.taskType, c])));
      setTavan(res.istekBasinaTavan);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { costs, tavan };
}

// ---------------------------------------------------------------------------
// Üst çubuk göstergesi
// ---------------------------------------------------------------------------

const METER_STYLES = {
  green: { bar: "bg-emerald-500", text: "text-slate-600", ring: "border-slate-200" },
  amber: { bar: "bg-amber-500", text: "text-amber-700", ring: "border-amber-300 bg-amber-50" },
  red: { bar: "bg-red-600", text: "text-red-700", ring: "border-red-300 bg-red-50" },
} as const;

/**
 * Üst çubuktaki kredi göstergesi (kalan / toplam).
 *
 * BYO-LLM ve sınırsız modda gösterge GİZLENİR; yerine "Limitsiz mod aktif"
 * rozeti gelir. Kotasız bir büroya kota göstergesi göstermek yanlış bilgidir.
 */
export function CreditMeter({ wallet }: { wallet: CreditWalletResponse | null }) {
  if (!wallet) return null;

  if (wallet.limitsiz || !wallet.cuzdan) {
    return (
      <Link
        href="/app/ayarlar/ai-kullanim"
        title={wallet.aciklama}
        className="hidden items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 sm:inline-flex"
      >
        <span aria-hidden="true">∞</span>
        Limitsiz mod aktif
      </Link>
    );
  }

  const c = wallet.cuzdan;
  const total = c.dahilKota + c.satinAlinan;
  const tone = meterTone(c.kullanimYuzdesi);
  const style = METER_STYLES[tone];

  return (
    <Link
      href="/app/ayarlar/ai-kullanim"
      title={`AI kredisi: ${c.kullanilabilir} / ${total} · dönem ${c.donemBaslangic.slice(0, 10)} → ${c.donemBitis.slice(0, 10)}${c.rezerve > 0 ? ` · ${c.rezerve} kredi devam eden çağrılar için rezerve` : ""}`}
      className={`hidden min-w-[9.5rem] rounded-lg border px-3 py-1.5 transition-colors hover:bg-slate-50 sm:block ${style.ring}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          AI kredisi
        </span>
        <span className={`text-xs font-bold tabular-nums ${style.text}`}>
          {c.kullanilabilir}
          <span className="font-normal text-slate-400"> / {total}</span>
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={c.kullanimYuzdesi}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Dönemlik AI kredisi kullanımı"
      >
        <div
          className={`h-full rounded-full transition-all ${style.bar}`}
          style={{ width: `${Math.min(100, c.kullanimYuzdesi)}%` }}
        />
      </div>
    </Link>
  );
}

/** %80'de panelde görünen uyarı şeridi. */
export function CreditWarningBanner({ wallet }: { wallet: CreditWalletResponse | null }) {
  if (!wallet?.cuzdan || wallet.limitsiz) return null;
  const c = wallet.cuzdan;
  if (c.kullanimYuzdesi < 80) return null;

  const bitti = c.kullanilabilir <= 0;
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        bitti ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
      role="status"
    >
      <p className="font-semibold">
        {bitti
          ? "Dönemlik AI krediniz bitti."
          : `Dönemlik AI kredinizin %${c.kullanimYuzdesi}'i kullanıldı (${c.kullanilabilir} kredi kaldı).`}
      </p>
      <p className="mt-1">
        {bitti ? "Yalnızca kredili AI işlemleri durdu. " : ""}
        Dosya, müvekkil, duruşma, süre, görev ve belge işlemleriniz — süre hesabı ve belge
        sınıflandırma dâhil — <strong>çalışmaya devam ediyor.</strong>
      </p>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/app/ayarlar/ai-kullanim" className="font-medium underline underline-offset-2">
          Ek paket al
        </Link>
        <Link href="/app/ayarlar/ai-saglayici" className="font-medium underline underline-offset-2">
          Kendi API anahtarınızı bağlayın, limit kalksın
        </Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI düğmelerindeki maliyet etiketi
// ---------------------------------------------------------------------------

/**
 * "Tam Dosya Analizi · 20 kredi" etiketi.
 * Fiyat bilinmiyorsa hiçbir şey göstermez — uydurma sayı yazmaz.
 */
export function CreditBadge({
  taskType,
  costs,
  className = "",
}: {
  taskType: string;
  costs: Map<string, CreditCost>;
  className?: string;
}) {
  const cost = costs.get(taskType);
  if (!cost) return null;
  if (cost.isFree) {
    return (
      <span
        className={`inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ${className}`}
        title="Bu işlem kredi tüketmez."
      >
        ücretsiz
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600 ${className}`}
      title={cost.description ?? `${cost.credits} kredi`}
    >
      {cost.credits} kredi
    </span>
  );
}

// ---------------------------------------------------------------------------
// 402 / 400 kartları
// ---------------------------------------------------------------------------

/**
 * Kredi hatası kartı — 402 (bakiye yetersiz) ve 400 (istek çok büyük).
 * İlgisiz hatalarda `null` döner; çağıran kendi hata gösterimini sürdürür.
 */
export function CreditErrorCard({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): ReactNode {
  const insufficient = asInsufficientCredits(error);
  const tooLarge = asRequestTooLarge(error);

  if (tooLarge) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">İstek çok büyük — sağlayıcıya gönderilmedi.</p>
        <p className="mt-1">{tooLarge.message}</p>
        <p className="mt-2">{tooLarge.oneri}</p>
      </div>
    );
  }

  if (!insufficient) return null;

  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-800">
      <p className="text-base font-semibold text-slate-900">Kredi bakiyeniz yetersiz</p>
      <p className="mt-1">{insufficient.message}</p>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Kalan kredi</dt>
          <dd className="text-lg font-bold tabular-nums text-slate-900">{insufficient.kalanKredi}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Gereken kredi</dt>
          <dd className="text-lg font-bold tabular-nums text-slate-900">{insufficient.gerekenKredi}</dd>
        </div>
      </dl>

      {insufficient.paketler.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ek kredi paketleri
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {insufficient.paketler.map((p) => (
              <li
                key={p.key}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs"
              >
                <span className="font-semibold tabular-nums">{p.credits.toLocaleString("tr-TR")}</span>{" "}
                kredi ·{" "}
                <span className="tabular-nums">
                  {Number(p.price).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {p.currency}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/app/ayarlar/ai-kullanim"
          className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
        >
          Ek paket al
        </Link>
        <Link
          href="/app/ayarlar/ai-saglayici"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Kendi API anahtarımı bağlayayım (limitsiz)
        </Link>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Yeniden dene
          </button>
        )}
      </div>

      {insufficient.engellenmeyenler && (
        <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-600">
          <strong>Etkilenmeyenler:</strong> {insufficient.engellenmeyenler}
        </p>
      )}
    </div>
  );
}

/**
 * Kredi hatası uyarısı — `/app` kabuğunda TEK örnek olarak durur.
 *
 * Herhangi bir AI ekranı 402 (bakiye yetersiz) veya 50-kredi tavanı hatası
 * aldığında `notifyCreditError()` çağırır; açıklayıcı kart burada belirir.
 * Kart KAPATILABİLİR: kullanıcıyı ekranın başında tutmaz, yalnız bilgilendirir.
 */
export function CreditErrorAlert() {
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const handler = (e: Event) => setError((e as CustomEvent).detail);
    window.addEventListener(CREDIT_ERROR_EVENT, handler);
    return () => window.removeEventListener(CREDIT_ERROR_EVENT, handler);
  }, []);

  if (!error) return null;
  const card = CreditErrorCard({ error });
  if (!card) return null;

  return (
    <div className="relative">
      {card}
      <button
        type="button"
        onClick={() => setError(null)}
        aria-label="Uyarıyı kapat"
        className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </button>
    </div>
  );
}
