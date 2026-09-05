"use client";

/**
 * Duruşma hazırlık paketi (HEARING_PREP) — 9 SABİT bölüm. Bölüm anahtarları
 * packages/legal-ai HEARING_PREP_SECTION_KEYS ile birebir; kaynaksız bölümler
 * "teyitsiz" rozetiyle gösterilir, noData bölümleri dürüstçe boş kalır.
 */

import { Badge, Modal } from "@/components/ui";

export interface PrepSection {
  content: string;
  bullets?: string[];
  sourceRefs?: Array<{ documentTitle?: string; page?: number | null; quote?: string | null }>;
  noData?: boolean;
}

export interface HearingPrepPackage {
  sections: Record<string, PrepSection>;
}

export const PREP_SECTION_TITLES: Array<[string, string]> = [
  ["case_summary", "Dosya özeti"],
  ["recent_events", "Son gelişmeler (90 gün)"],
  ["opponent_last_statement", "Karşı tarafın son beyanı"],
  ["last_decision", "Son ara karar"],
  ["missing_evidence", "Eksik deliller"],
  ["questions_to_ask", "Sorulacak sorular"],
  ["points_to_raise", "İleri sürülecek hususlar"],
  ["deadlines", "Süreler"],
  ["previous_minutes", "Önceki celse tutanağı"],
];

export function parsePrep(json: string | null | undefined): HearingPrepPackage | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as HearingPrepPackage;
    return parsed && typeof parsed === "object" && parsed.sections ? parsed : null;
  } catch {
    return null;
  }
}

export function HearingPrepModal({
  open,
  onClose,
  title,
  prep,
  model,
  warnings,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  prep: HearingPrepPackage | null;
  model?: string | null;
  warnings?: string[];
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {!prep ? (
        <p className="text-sm text-slate-600">Hazırlık paketi bulunamadı.</p>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Bu paket AI tarafından yalnız dosya bağlamından üretilmiş bir HAZIRLIK notudur; hukuki değerlendirme avukata aittir.
            Kaynaksız bölümler teyitsizdir.{model ? ` Model: ${model}.` : ""}
          </p>
          {warnings && warnings.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-slate-600">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {PREP_SECTION_TITLES.map(([key, label]) => {
            const s = prep.sections[key];
            if (!s) return null;
            const unsourced = !s.noData && (!s.sourceRefs || s.sourceRefs.length === 0);
            return (
              <section key={key} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
                  {s.noData && <Badge tone="gray">Bağlamda veri yok</Badge>}
                  {unsourced && <Badge tone="gold">Teyitsiz</Badge>}
                </div>
                {s.content && <p className="whitespace-pre-line text-sm text-slate-700">{s.content}</p>}
                {s.bullets && s.bullets.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                    {s.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
                {s.sourceRefs && s.sourceRefs.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Kaynak: {s.sourceRefs.map((r) => `${r.documentTitle ?? "?"}${r.page ? ` s.${r.page}` : ""}`).join(" · ")}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
