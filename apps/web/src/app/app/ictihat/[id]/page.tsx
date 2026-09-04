"use client";

/**
 * İÇTİHAT KARAR DETAYI — /app/ictihat/[id]
 *
 * Arama sonuçlarından gelen her satır buraya açılır: tam künye, özet, TAM
 * METİN (varsa), kaynak bağlantısı ve bu büronun karara bağlı olduğu dosyalar
 * (emsal bağları). Künye kayıttan gelir; arama sonucu kartındaki bilginin
 * aynısı değil, kaydın kendisidir.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { detailCaseLaw } from "@/lib/faz2";
import type { CaseLawDocDetail } from "@/lib/types";
import { Badge, Button, Card, ErrorBox, Spinner } from "@/components/ui";
import { fmtDate, isDemoCaseLaw } from "@/lib/labels";

const STATUS_LABELS: Record<string, string> = {
  ADAY: "Aday",
  KABUL: "Kabul",
  RED: "Red",
};

export default function IctihatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [doc, setDoc] = useState<CaseLawDocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then((p) => setId(p.id));
  }, [params]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setDoc(await detailCaseLaw(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Karar detayı yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner label="Karar yükleniyor…" />;
  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/app/ictihat" className="text-sm text-slate-500 hover:text-slate-700">
          ← İçtihat aramaya dön
        </Link>
        <ErrorBox message={error} />
        <Button variant="secondary" onClick={() => void load()}>
          Yeniden dene
        </Button>
      </div>
    );
  }
  if (!doc) return null;

  const demo = isDemoCaseLaw(doc);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/app/ictihat" className="text-sm text-slate-500 hover:text-slate-700">
            ← İçtihat aramaya dön
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">{doc.court}</h1>
          <p className="mt-1 text-sm text-slate-500">
            E. {doc.caseNumber} · K. {doc.decisionNumber}
            {doc.decisionDate ? ` · ${fmtDate(doc.decisionDate)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {demo && <Badge tone="yellow">DEMO VERİ</Badge>}
          {doc.sourceAdapter && <Badge tone="gray">{doc.sourceAdapter}</Badge>}
          {doc.sourceUrl && (
            <a
              href={doc.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              Kaynağı aç ↗
            </a>
          )}
        </div>
      </div>

      {demo && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Bu kayıt demo/besleme testi verisidir; gerçek bir mahkeme kararı değildir. Dilekçede
          kaynak olarak kullanılmaz.
        </p>
      )}

      {doc.summary && (
        <Card title="Özet">
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{doc.summary}</p>
        </Card>
      )}

      <Card title="Karar metni">
        {doc.fullText ? (
          <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {doc.fullText}
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            Bu kaydın tam metni sistemde tutulmuyor. Tam metin için kaynak bağlantısını kullanın
            veya büronuz metini elle karar girişiyle ekleyebilir.
          </p>
        )}
      </Card>

      <Card title="Bu büronun bağlı dosyaları">
        {(doc.linkedCases ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">
            Bu karar henüz büronuzun dosyalarına emsal olarak bağlanmamış. Arama sayfasından
            &quot;Dosyaya emsal olarak ekle&quot; ile bağlayabilirsiniz.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(doc.linkedCases ?? []).map((lc) => (
              <li key={lc.referenceId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <Link
                    href={`/app/dosyalar/${lc.case.id}`}
                    className="text-sm font-medium text-slate-800 hover:text-slate-950"
                  >
                    {lc.case.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {lc.case.courtName ?? ""}
                    {lc.case.fileNumber ? ` · ${lc.case.fileNumber}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {lc.relevanceNote && (
                    <span className="max-w-xs truncate text-xs text-slate-500" title={lc.relevanceNote}>
                      {lc.relevanceNote}
                    </span>
                  )}
                  <Badge tone={lc.status === "KABUL" ? "green" : lc.status === "RED" ? "red" : "gray"}>
                    {STATUS_LABELS[lc.status ?? ""] ?? lc.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
