"use client";

/**
 * SÖZLEŞMELER LİSTESİ — Sözleşme Analizi ve Simülasyon girişi.
 *
 * Kartlar: başlık, müvekkil (veya "ilişkisiz"), sürüm sayısı, genel risk
 * skoru bandı (yeşil/sarı/kırmızı — SON ANALİZ KOŞUSUNDAN), durum.
 *
 * Skor bandı `GET /contracts/analyses/latest-scores` ucundan gelir; analiz
 * çalıştırılmamış sözleşmede bant YOK — risksiz görünmesi DEĞİL, ölçülmemiş
 * olması gösterilir (para/skor disiplini).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, EmptyState, ErrorBox, Select, Spinner, TruncationNotice } from "@/components/ui";
import { errText } from "@/lib/faz2";
import { SERVER_MAX_PAGE_SIZE } from "@/lib/api";
import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONES,
  CONTRACT_TYPE_LABELS,
  fmtDate,
  labelOf,
} from "@/lib/labels";
import { listContractsPaged, isFeatureMissing } from "../_lib/faz5";
import { listLatestScores } from "../_lib/contract-analysis";
import {
  CONTRACT_ANALYSIS_MODE_LABELS,
  CONTRACT_RISK_BAND_LABELS,
  CONTRACT_RISK_BAND_TONES,
} from "@/lib/labels";
import type { ContractItem } from "../_lib/faz5-types";
import type { LatestScoreEntry } from "../_lib/contract-analysis-types";

export default function SozlesmelerPage() {
  const [items, setItems] = useState<ContractItem[]>([]);
  const [scores, setScores] = useState<Record<string, LatestScoreEntry>>({});
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      const [res, scoreMap] = await Promise.all([
        listContractsPaged({ status: status || undefined, limit: SERVER_MAX_PAGE_SIZE }),
        listLatestScores().catch(() => ({})),
      ]);
      setItems(res.items);
      setScores(scoreMap);
      setTruncated(res.hasMore || res.truncated);
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Sözleşmeler yüklenemedi."));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Sözleşmeler</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sözleşme yaşam döngüsü, iki taraflı analiz, şerhler ve sürüm farkları.
          </p>
        </div>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">(tüm durumlar)</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {labelOf(CONTRACT_STATUS_LABELS, s)}
            </option>
          ))}
        </Select>
      </div>

      {error && <ErrorBox message={error} />}

      {loading ? (
        <Spinner label="Sözleşmeler yükleniyor…" />
      ) : missing ? (
        <Card title="Sözleşmeler">
          <EmptyState message="Sözleşme modülü henüz hazır değil." />
        </Card>
      ) : (
        <Card title={`Sözleşmeler (${items.length})`}>
          {truncated && <TruncationNotice shown={items.length} noun="sözleşme" />}
          {items.length === 0 ? (
            <EmptyState message="Kayıtlı sözleşme yok. Sözleşme kaydı bir müvekkil ya da dosya kartından açılır." />
          ) : (
            <ul className="space-y-3">
              {items.map((c) => (
                <ContractListRow key={c.id} contract={c} score={scores[c.id] ?? null} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <p className="text-xs leading-5 text-slate-500">
        Skor bandı son analiz koşusunun sunucu hesabıdır (KRİTİK=10 / ORTA=5 / DÜŞÜK=2 ağırlıklı
        şerh bileşimi, 100'e normalize). Analiz çalıştırılmamış sözleşmede bant yoktur —
        risksiz görünmesi değil, henüz ölçülmemiş olduğu gösterilir.
      </p>
    </div>
  );
}

function ContractListRow({ contract, score }: { contract: ContractItem; score: LatestScoreEntry | null }) {
  const versionCount = contract.versions?.length ?? 0;
  return (
    <li>
      <Link
        href={`/app/sozlesmeler/${contract.id}`}
        className="block rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-amber-300"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-slate-900">{contract.title}</p>
              <Badge tone={CONTRACT_STATUS_TONES[contract.status] ?? "gray"}>
                {labelOf(CONTRACT_STATUS_LABELS, contract.status)}
              </Badge>
              <Badge tone="gray">{labelOf(CONTRACT_TYPE_LABELS, contract.type)}</Badge>
              {score ? (
                <Badge tone={CONTRACT_RISK_BAND_TONES[score.band ?? "DUSUK"] ?? "gray"}>
                  {labelOf(CONTRACT_RISK_BAND_LABELS, score.band ?? "DUSUK")} · {score.score}/100
                </Badge>
              ) : (
                <Badge tone="gray">Analiz edilmedi</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {contract.client?.name ?? "İlişkisiz sözleşme"}
              {contract.case?.title ? ` · ${contract.case.title}` : ""} · {versionCount} sürüm
              {contract.effectiveFrom ? ` · yürürlük: ${fmtDate(contract.effectiveFrom)}` : ""}
              {score ? ` · son analiz: ${labelOf(CONTRACT_ANALYSIS_MODE_LABELS, score.mode)}` : ""}
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-amber-600">Detay →</span>
        </div>
      </Link>
    </li>
  );
}
