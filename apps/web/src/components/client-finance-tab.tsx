"use client";

/**
 * Müvekkil kartı → Finans sekmesi (Modül 08).
 *
 * GET /finance/clients/:clientId/summary — açık dosya, tahakkuk, tahsil,
 *                                          bekleyen, masraf, avans, risk
 * GET /finance/entries?clientId=          — hareket listesi
 *
 * PARA: özet alanlarının tamamı SUNUCU hesabıdır. Uç yoksa "hesap yok" denir;
 * arayüz hareketleri toplayarak KENDİ ÖZETİNİ ÜRETMEZ — çünkü avans mahsubu ve
 * kısmi ödeme mantığı istemcide doğru kurulamaz ve yanlış bakiye göstermek
 * bakiye göstermemekten kötüdür.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import { getClientFinanceSummary, listFinanceEntries, summaryFields } from "@/lib/finance";
import type { ClientFinanceSummary, FinanceEntry } from "@/lib/faz3-types";
import { Badge, Card, EmptyState, ErrorBox, Select, Spinner, StatCard } from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import { fmtAmount } from "@/lib/money";
import {
  COLLECTION_RISK_LABELS,
  COLLECTION_RISK_TONES,
  FINANCIAL_ENTRY_TYPE_LABELS,
  FINANCIAL_ENTRY_TYPE_TONES,
  fmtDate,
  labelOf,
} from "@/lib/labels";
import { FINANCIAL_ENTRY_TYPES } from "@nomosos/shared";

export function ClientFinanceTab({ clientId }: { clientId: string }) {
  const [summary, setSummary] = useState<ClientFinanceSummary | null>(null);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, e] = await Promise.all([
        getClientFinanceSummary(clientId),
        listFinanceEntries({ clientId, type: typeFilter || undefined, limit: 200 }).catch(
          () => [] as FinanceEntry[],
        ),
      ]);
      setSummary(s);
      setEntries(e);
      setMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setMissing(true);
        setSummary(null);
      } else {
        setError(errText(err, "Müvekkil finans özeti alınamadı."));
      }
    } finally {
      setLoading(false);
    }
  }, [clientId, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <FeatureUnavailable
        title="Finans modülü henüz yayında değil"
        detail="/api/v1/finance/clients/:id/summary yayına alındığında bu sekme dolacak."
        onRetry={() => void load()}
      />
    );
  }
  if (loading) return <Spinner label="Finans özeti hesaplanıyor…" />;
  if (error) return <ErrorBox message={error} />;

  const f = summaryFields(summary);
  const currency = f?.currency ?? "TRY";

  return (
    <div className="space-y-6">
      <Card
        title="Finans Özeti"
        action={
          f?.risk ? (
            <Badge tone={COLLECTION_RISK_TONES[f.risk] ?? "gray"}>
              {labelOf(COLLECTION_RISK_LABELS, f.risk)}
            </Badge>
          ) : undefined
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Açık Dosya"
            value={f?.openCases ?? "—"}
            tone="navy"
          />
          <StatCard label="Tahakkuk" value={fmtAmount(f?.accrued, currency)} tone="slate" />
          <StatCard label="Tahsil Edilen" value={fmtAmount(f?.collected, currency)} tone="green" />
          <StatCard label="Bekleyen Bakiye" value={fmtAmount(f?.outstanding, currency)} tone="gold" />
          <StatCard label="Masraf" value={fmtAmount(f?.expenses, currency)} tone="slate" />
          <StatCard label="Avans Bakiyesi" value={fmtAmount(f?.advance, currency)} tone="slate" />
        </div>
        <p className="mt-4 text-[11px] leading-5 text-slate-400">
          Bakiye formülü deterministiktir ve sunucuda uygulanır: tahakkuklar − tahsilatlar −
          avans mahsupları. AI hiçbir zaman bakiye hesaplamaz. Bir kart &quot;—&quot; gösteriyorsa
          sunucu o alanı döndürmemiştir.
        </p>
      </Card>

      <Card
        title="Hareketler"
        action={
          <div className="w-52">
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Hareket tipi süzgeci"
              className="!py-1.5 text-xs"
            >
              <option value="">Tüm tipler</option>
              {FINANCIAL_ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(FINANCIAL_ENTRY_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {entries.length === 0 ? (
          <EmptyState message="Bu müvekkile ait finans hareketi yok." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Tarih</th>
                  <th className="py-2 pr-4 font-medium">Tip</th>
                  <th className="py-2 pr-4 font-medium">Dosya</th>
                  <th className="py-2 pr-4 font-medium">Açıklama</th>
                  <th className="py-2 pr-4 text-right font-medium">Tutar</th>
                  <th className="py-2 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4 text-xs text-slate-500">{fmtDate(e.date)}</td>
                    <td className="py-3 pr-4">
                      <Badge tone={FINANCIAL_ENTRY_TYPE_TONES[e.type] ?? "gray"}>
                        {labelOf(FINANCIAL_ENTRY_TYPE_LABELS, e.type)}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-500">
                      {e.case ? (
                        <Link href={`/app/dosyalar/${e.case.id}`} className="hover:text-amber-600">
                          {e.case.fileNumber ?? e.case.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{e.description ?? "—"}</td>
                    <td className="py-3 pr-4 text-right font-medium tabular-nums text-slate-900">
                      {fmtAmount(e.amount, e.currency ?? currency)}
                    </td>
                    <td className="py-3">
                      {e.invoiceId ? (
                        <Link
                          href={`/app/faturalar/${e.invoiceId}`}
                          className="text-xs text-amber-600 hover:text-amber-500"
                        >
                          Faturalandı →
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {e.isBillable === false ? "Yansıtılmaz" : "Faturalanmadı"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
