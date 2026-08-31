"use client";

/**
 * "AI ile yorumla" — OPSİYONEL ve KREDİLİ.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LLM RAKAM ÜRETMEZ (ortak karar 1).                                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Ekrandaki bütün sayılar veritabanından deterministik olarak gelir; AI
 * yalnızca HAZIR rakamları Türkçe yorumlar. Bu yüzden:
 *   • Çıktı "öneri" şeridiyle kuşatılır (`AiDisclaimer`).
 *   • Yorumun dayandığı ölçüler ADIYLA listelenir (kaynak gösterme zorunlu).
 *   • Kredi maliyeti düğmenin ÜZERİNDE, tıklamadan ÖNCE görünür.
 *   • Rapor bir kez daha çalıştırıldığında yorum TEMİZLENİR — eski dönemin
 *     yorumu yeni rakamların altında durmaz.
 */

import { AiDisclaimer } from "@/components/ai-ui";
import { Button, Card } from "@/components/ui";
import { CreditBadge } from "@/components/credits";
import type { CreditCost } from "@/lib/credits";
import type { ReportColumn, ReportMetric, ReportNarrative } from "../../_lib/faz6-types";

export function NarrativePanel({
  taskType,
  costs,
  narrative,
  busy,
  error,
  metrics,
  columns,
  onRun,
  onClear,
}: {
  taskType: string;
  costs: Map<string, CreditCost>;
  narrative: ReportNarrative | null;
  busy: boolean;
  error: string | null;
  metrics: ReportMetric[];
  columns: ReportColumn[];
  onRun: () => void;
  onClear: () => void;
}) {
  const labelOfKey = (key: string) =>
    metrics.find((m) => m.key === key)?.label ??
    columns.find((c) => c.key === key)?.label ??
    key;

  // `print:hidden` — kâğıda basılmaz. Dolaşıma giren bir rapor çıktısında LLM
  // metninin deterministik rakamlarla aynı sayfada ve aynı ağırlıkta durması
  // istenmez; yorum ekranda, "öneri" şeridiyle birlikte okunur.
  return (
    <Card
      title="AI yorumu"
      action={
        narrative ? (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Temizle
          </Button>
        ) : undefined
      }
      className="print:hidden"
    >
      {!narrative && (
        <p className="text-xs leading-5 text-slate-500">
          Yukarıdaki rakamlar <strong>değişmez</strong>. AI yalnızca bu hazır rakamları Türkçe
          bir yönetici özetine çevirir; kendi başına hiçbir sayı hesaplamaz veya tahmin etmez.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="secondary" onClick={onRun} disabled={busy}>
          {busy ? "Yorumlanıyor…" : narrative ? "Yeniden yorumla" : "AI ile yorumla"}
        </Button>
        <CreditBadge taskType={taskType} costs={costs} />
        <span className="text-[11px] text-slate-400">
          Kredi yalnızca bu düğmeye bastığınızda tüketilir.
        </span>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {narrative && (
        <div className="mt-4 space-y-3">
          <AiDisclaimer text="Bu yorum bir ÖNERİDİR. Rakamlar deterministik olarak hesaplanmıştır; yorumun kendisi AI çıktısıdır ve karar öncesi doğrulanmalıdır." />
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{narrative.text}</p>
          {narrative.basedOn.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Yorumun dayandığı ölçüler
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {narrative.basedOn.map(labelOfKey).join(" · ")}
              </p>
            </div>
          )}
          {narrative.model && (
            <p className="text-[11px] text-slate-400">Model: {narrative.model}</p>
          )}
        </div>
      )}
    </Card>
  );
}
