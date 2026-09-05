import { pricing } from "./content";

/**
 * Faz 8A — fiyat vitrini: PlanTier kataloğu sunucudan (GET /public/plans) okunur; vitrin ile DB
 * fiyatı tek kaynaktan gelir. API erişilemezse sessizce "teklif" satırına düşer (sayfa kırılmaz).
 * Sunucu bileşeni: tarayıcıya API adresi sızmaz; 5 dakikada bir tazelenir.
 */

interface PublicPlan {
  key: string;
  name: string;
  monthlyPricePerUser: string | null;
  annualPricePerUser: string | null;
  annualMonthlyEquivalent: string | null;
  maxUsers: number | null;
  byoLlmDiscountPercent: number;
}

function apiBase(): string {
  return (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

function tl(v: string | null): string {
  if (!v) return "Teklif";
  const n = Number(v);
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₺`;
}

export async function PublicPlans() {
  let plans: PublicPlan[] = [];
  let vatNote = "";
  try {
    const res = await fetch(`${apiBase()}/api/v1/public/plans`, { next: { revalidate: 300 } });
    if (res.ok) {
      const data = (await res.json()) as { items: PublicPlan[]; vatIncluded: boolean; vatRatePercent: number };
      plans = data.items;
      vatNote = data.vatIncluded ? "KDV dahil" : `KDV (%${data.vatRatePercent}) hariç`;
    }
  } catch {
    plans = [];
  }
  if (plans.length === 0) {
    return <p className="mt-8 text-sm text-[var(--ink-soft)]">{pricing.footnote}</p>;
  }
  const order = ["SOLO", "BURO", "ENTERPRISE"];
  const sorted = [...plans].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const discount = sorted[0]?.byoLlmDiscountPercent ?? 30;
  return (
    <div className="mt-10" data-testid="fiyat-vitrini">
      <div className="grid gap-4 sm:grid-cols-3">
        {sorted.map((p) => (
          <div key={p.key} className="rounded-[5px] border border-[var(--rule)] bg-white p-6">
            <p className="serif text-[1.1rem] font-semibold text-[var(--ink)]">{p.name}</p>
            <p className="tnum mt-3 text-[2rem] font-semibold leading-none text-[var(--ink)]">
              {tl(p.monthlyPricePerUser)}
              {p.monthlyPricePerUser && <span className="text-[0.9rem] font-normal text-[var(--ink-soft)]"> / kullanıcı / ay</span>}
            </p>
            {p.annualMonthlyEquivalent && (
              <p className="tnum mt-2 text-sm text-[var(--ink-soft)]">
                Yıllık ödemede aylık {tl(p.annualMonthlyEquivalent)} ({tl(p.annualPricePerUser)} / yıl)
              </p>
            )}
            <p className="mt-2 text-xs text-[var(--ink-soft)]">{p.maxUsers ? `En çok ${p.maxUsers} kullanıcı` : "Kullanıcı sınırı sözleşmeyle"}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-[var(--ink-soft)]">
        Fiyatlar {vatNote}. Kendi yapay zekâ anahtarınızı bağlarsanız abonelikte %{discount} indirim uygulanır. Kurumsal planda kurulum ve eğitim teklife göre belirlenir.
      </p>
    </div>
  );
}
