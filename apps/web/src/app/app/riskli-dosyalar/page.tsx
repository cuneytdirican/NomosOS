"use client";

/**
 * Riskli Dosyalar — `/app/riskli-dosyalar` (Modül 17, büro risk listesi).
 *
 * Kaynak: `GET /risk/office` (bant ve boyut süzgeçli). Partner'ın sabah tek
 * bakışta "büromda riskli N dosya var" diyebilmesi için vardır; her satırdan
 * dosyanın risk kartına geçilir.
 *
 * YETKİ NOTU: listenin kapsamını SUNUCU belirler — PARTNER/ADMIN tüm dosyaları,
 * AVUKAT yalnızca kendi dosyalarını görür. İstemci ayrıca süzmez.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Select, Spinner } from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import { errText, isFeatureMissing } from "@/lib/faz2";
import {
  CASE_STATUS_LABELS,
  RISK_BANDS,
  RISK_BAND_BARS,
  RISK_BAND_DOTS,
  RISK_BAND_LABELS,
  RISK_BAND_TONES,
  RISK_DIMENSIONS,
  RISK_DIMENSION_LABELS,
  fmtDateTime,
  labelOf,
  riskBandOf,
} from "@/lib/labels";
import { riskOffice } from "../_lib/faz4";
import type { RiskCaseRow } from "../_lib/faz4-types";

export default function RiskliDosyalarPage() {
  const [rows, setRows] = useState<RiskCaseRow[]>([]);
  const [band, setBand] = useState("");
  const [dimension, setDimension] = useState("");
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      setRows(await riskOffice({ band: band || undefined, dimension: dimension || undefined }));
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Riskli dosya listesi yüklenemedi."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [band, dimension]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const acc: Record<string, number> = { DUSUK: 0, ORTA: 0, YUKSEK: 0 };
    for (const r of rows) {
      const key = String(r.band ?? riskBandOf(r.score));
      if (acc[key] !== undefined) acc[key] += 1;
    }
    return acc;
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Riskli Dosyalar</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Skor tabanı deterministik kural sinyalleridir; AI yalnız sınırlı bir düzeltme
            önerir ve bandı tek başına değiştiremez.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {RISK_BANDS.map((b) => (
            <span
              key={b}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
            >
              {RISK_BAND_DOTS[b]} {labelOf(RISK_BAND_LABELS, b)}:{" "}
              <strong className="text-slate-900">{counts[b] ?? 0}</strong>
            </span>
          ))}
        </div>
      </div>

      {missing ? (
        <FeatureUnavailable
          title="Büro risk listesi henüz hazır değil"
          detail="Risk uçları yayına alındığında bu ekran otomatik olarak çalışacak."
          onRetry={() => void load()}
        />
      ) : (
        <Card>
          <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,14rem)_auto] sm:items-end">
            <Field label="Bant">
              <Select value={band} onChange={(e) => setBand(e.target.value)}>
                <option value="">Tümü</option>
                {RISK_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {labelOf(RISK_BAND_LABELS, b)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Boyut">
              <Select value={dimension} onChange={(e) => setDimension(e.target.value)}>
                <option value="">Genel skora göre</option>
                {RISK_DIMENSIONS.filter((d) => d !== "GENEL").map((d) => (
                  <option key={d} value={d}>
                    {labelOf(RISK_DIMENSION_LABELS, d)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="secondary" disabled={loading} onClick={() => void load()}>
              Yenile
            </Button>
          </div>

          {loading ? (
            <Spinner label="Risk listesi hazırlanıyor…" />
          ) : error ? (
            <ErrorBox message={error} />
          ) : rows.length === 0 ? (
            <EmptyState
              message={
                band || dimension
                  ? "Bu süzgeçle eşleşen dosya yok."
                  : "Riskli dosya yok ya da henüz risk hesabı yapılmadı."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4 font-medium">Dosya</th>
                    <th className="py-2 pr-4 font-medium">Skor</th>
                    <th className="py-2 pr-4 font-medium">Bant</th>
                    <th className="py-2 pr-4 font-medium">Baskın boyut</th>
                    <th className="py-2 pr-4 font-medium">Sorumlu</th>
                    <th className="py-2 font-medium">Son hesap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...rows]
                    .sort((a, b) => b.score - a.score)
                    .map((r) => {
                      const rowBand = String(r.band ?? riskBandOf(r.score));
                      const title =
                        r.case?.title ?? r.caseTitle ?? r.case?.fileNumber ?? "Dosya";
                      const top = r.topDimension ?? r.dimension ?? null;
                      return (
                        <tr key={r.caseId} className="hover:bg-slate-50">
                          <td className="py-3 pr-4">
                            <Link
                              href={`/app/dosyalar/${r.caseId}?sekme=risk`}
                              className="font-medium text-slate-900 hover:text-amber-600"
                            >
                              {title}
                            </Link>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {r.case?.fileNumber ?? r.fileNumber ?? ""}
                              {r.case?.courtName ? ` · ${r.case.courtName}` : ""}
                              {r.case?.status
                                ? ` · ${labelOf(CASE_STATUS_LABELS, r.case.status)}`
                                : ""}
                            </p>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="w-8 text-sm font-bold text-slate-900">
                                {r.score}
                              </span>
                              <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                                <span
                                  className={`block h-full rounded-full ${RISK_BAND_BARS[rowBand] ?? "bg-slate-400"}`}
                                  style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }}
                                />
                              </span>
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge tone={RISK_BAND_TONES[rowBand] ?? "gray"}>
                              {RISK_BAND_DOTS[rowBand] ?? ""}{" "}
                              {labelOf(RISK_BAND_LABELS, rowBand)}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4 text-slate-600">
                            {top ? labelOf(RISK_DIMENSION_LABELS, String(top)) : "—"}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">
                            {r.responsibleUser?.fullName ??
                              r.case?.responsibleUser?.fullName ??
                              "—"}
                          </td>
                          <td className="py-3 text-slate-500">{fmtDateTime(r.computedAt)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
