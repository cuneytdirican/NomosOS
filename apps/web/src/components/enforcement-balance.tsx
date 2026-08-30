"use client";

/**
 * İcra bakiye kartı.
 *
 * TEK KURAL: bu bileşen HİÇBİR TUTAR HESAPLAMAZ. Asıl alacak, faiz, masraf,
 * tahsil edilen ve kalan değerlerinin tamamı `GET /enforcement/:id/balance`
 * yanıtından okunur; açılır paneldeki hesap dökümü de sunucunun gönderdiği
 * adımlardır. Sunucu bir alanı göndermezse "—" yazılır — sıfır YAZILMAZ,
 * çünkü "0 ₺ borç" ile "bilinmiyor" hukuken aynı şey değildir.
 */

import { useState } from "react";
import { Badge, Button, ErrorBox, Spinner } from "@/components/ui";
import { fmtAmount } from "@/lib/money";
import { fmtDate } from "@/lib/labels";
import type { EnforcementBalance } from "@/lib/faz3-types";
import { balanceSteps } from "@/lib/enforcement";

export function BalanceCard({
  balance,
  loading,
  error,
  currency = "TRY",
  onRefresh,
}: {
  balance: EnforcementBalance | null;
  loading: boolean;
  error: string | null;
  currency?: string;
  onRefresh?: () => void;
}) {
  const [openSteps, setOpenSteps] = useState(false);
  const steps = balanceSteps(balance);
  const cur = balance?.currency ?? currency;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-900">
          Bakiye
          {balance?.asOf && (
            <span className="ml-2 text-xs font-normal text-slate-400">
              {fmtDate(balance.asOf)} itibarıyla
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <Badge tone="navy">Deterministik hesap</Badge>
          {onRefresh && (
            <Button size="sm" variant="secondary" onClick={onRefresh} disabled={loading}>
              Yenile
            </Button>
          )}
        </div>
      </header>

      <div className="p-5">
        {loading ? (
          <Spinner label="Bakiye hesaplanıyor…" />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !balance ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Bu dosya için henüz bakiye hesabı dönmedi.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Amount label="Asıl alacak" value={balance.principal} currency={cur} />
              <Amount label="İşlemiş faiz" value={balance.interest} currency={cur} />
              <Amount label="Masraf ve harç" value={balance.expenses} currency={cur} />
              <Amount label="Vekâlet ücreti" value={balance.attorneyFee} currency={cur} />
              <Amount
                label="Tahsil edilen"
                value={balance.collected}
                currency={cur}
                tone="green"
              />
              <Amount
                label="Kalan bakiye"
                value={balance.remaining}
                currency={cur}
                tone="strong"
                hint={balance.totalClaim ? `Takip çıkışı: ${fmtAmount(balance.totalClaim, cur)}` : undefined}
              />
            </div>

            {balance.warnings && balance.warnings.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {balance.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"
                  >
                    {w}
                  </li>
                ))}
              </ul>
            )}

            {steps.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setOpenSteps((v) => !v)}
                  aria-expanded={openSteps}
                  className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-slate-500 hover:text-amber-600"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`h-3.5 w-3.5 transition-transform ${openSteps ? "rotate-90" : ""}`}
                  >
                    <path d="M7.21 4.47a.75.75 0 0 1 1.06 0l5 5a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 1 1-1.06-1.06L11.69 10 7.21 5.53a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                  Hesap adımlarını {openSteps ? "gizle" : "göster"} ({steps.length} adım)
                </button>

                {openSteps && (
                  <ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-4">
                    {steps.map((s, i) => (
                      <li key={i} className="text-xs leading-5 text-slate-600">
                        <span className="font-medium text-slate-800">
                          {s.label ?? s.step ?? `Adım ${i + 1}`}
                        </span>
                        {s.amount !== undefined && s.amount !== null && (
                          <span className="ml-2 font-semibold tabular-nums text-slate-900">
                            {fmtAmount(s.amount, cur)}
                          </span>
                        )}
                        {(s.explanation ?? s.note) && (
                          <p className="mt-0.5 text-slate-500">{s.explanation ?? s.note}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            <p className="mt-4 text-[11px] leading-5 text-slate-400">
              Mahsup sırası masraf → faiz → asıl alacaktır ve değiştirilemez. Bu tutarların
              tamamı sunucuda hesaplanır; arayüz yalnızca gösterir.
              {balance.legalBasis ? ` Dayanak: ${balance.legalBasis}` : ""}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function Amount({
  label,
  value,
  currency,
  tone = "default",
  hint,
}: {
  label: string;
  value: unknown;
  currency: string;
  tone?: "default" | "green" | "strong";
  hint?: string;
}) {
  const text = fmtAmount(value as string | number | null | undefined, currency);
  const color =
    tone === "green"
      ? "text-emerald-700"
      : tone === "strong"
        ? "text-slate-900"
        : "text-slate-700";
  const box =
    tone === "strong"
      ? "border-amber-300 bg-amber-50"
      : "border-slate-200 bg-slate-50/60";
  return (
    <div className={`rounded-lg border px-4 py-3 ${box}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{text}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
