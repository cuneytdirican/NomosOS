"use client";

/**
 * Çatışma taraması sonuç kartı (Modül 11).
 *
 * Hem `/app/cakisma` sayfasında hem de yeni müvekkil formunda kullanılır.
 *
 * TASARIM İLKESİ — UYARI, ENGELLEME DEĞİL: kart hiçbir yerde bir akışı
 * durdurmaz, düğme devre dışı bırakmaz. Avukatlık Kanunu ve TBB Meslek
 * Kuralları çerçevesinde çatışma değerlendirmesi mesleki takdirdir; sistem
 * riski görünür kılar, kararı ve gerekçesini insana bırakır.
 */

import Link from "next/link";
import { Badge } from "@/components/ui";
import {
  CONFLICT_MATCH_TYPE_LABELS,
  CONFLICT_MATCH_TYPE_TONES,
  CONFLICT_RESULT_DOTS,
  CONFLICT_RESULT_LABELS,
  CONFLICT_RESULT_TONES,
  labelOf,
  similarityPercent,
} from "@/lib/labels";
import type { ConflictCheck, ConflictHit } from "../_lib/faz4-types";

const RESULT_MESSAGES: Record<string, string> = {
  TEMIZ: "Büro kayıtlarında eşleşme bulunamadı.",
  DIKKAT: "Değerlendirilmesi gereken eşleşmeler var.",
  CAKISMA: "Çıkar çatışması ihtimali taşıyan eşleşme(ler) bulundu.",
};

export function ConflictResultCard({
  check,
  compact = false,
  children,
}: {
  check: ConflictCheck;
  /** Form içinde daha dar bir gösterim (başlık ve kenarlık sadeleşir). */
  compact?: boolean;
  /** Karar formu gibi ek içerik. */
  children?: React.ReactNode;
}) {
  const result = String(check.result ?? "TEMIZ");
  const hits = check.hits ?? [];

  return (
    <section
      className={`rounded-xl border ${
        result === "CAKISMA"
          ? "border-red-300 bg-red-50"
          : result === "DIKKAT"
            ? "border-amber-300 bg-amber-50"
            : "border-emerald-200 bg-emerald-50"
      } ${compact ? "px-4 py-3" : "px-5 py-4"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            <span aria-hidden="true">{CONFLICT_RESULT_DOTS[result] ?? "⚪"}</span>
            <span className="truncate">{check.query}</span>
            <Badge tone={CONFLICT_RESULT_TONES[result] ?? "gray"}>
              {labelOf(CONFLICT_RESULT_LABELS, result)}
            </Badge>
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-700">
            {RESULT_MESSAGES[result] ?? ""}{" "}
            {hits.length > 0 ? `(${hits.length} bulgu)` : ""}
          </p>
        </div>
      </div>

      {hits.length > 0 && (
        <ul className="mt-3 space-y-2">
          {hits.map((h) => (
            <HitRow key={h.id ?? `${h.matchedName}-${h.matchType}`} hit={h} />
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-black/5 pt-2 text-[11px] font-medium leading-5 text-slate-700">
        Bu bir <strong>uyarıdır</strong>, karar sizindir. Tarama kaydı işi kabul edip
        etmeme kararınızı engellemez; hem bulgular hem kararınız denetim izine yazılır.
      </p>

      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

function HitRow({ hit }: { hit: ConflictHit }) {
  const pct = similarityPercent(hit.similarity);
  const matchType = String(hit.matchType);
  return (
    <li className="rounded-lg border border-white/60 bg-white px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">{hit.matchedName}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {hit.entityType}
            {hit.caseId ? (
              <>
                {" · "}
                <Link
                  href={`/app/dosyalar/${hit.caseId}`}
                  className="text-amber-600 hover:text-amber-500"
                >
                  {hit.case?.title ?? hit.case?.fileNumber ?? "ilgili dosya"}
                </Link>
              </>
            ) : null}
          </p>
          {hit.note && <p className="mt-1 text-xs leading-5 text-slate-600">{hit.note}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={CONFLICT_MATCH_TYPE_TONES[matchType] ?? "gray"}>
            {labelOf(CONFLICT_MATCH_TYPE_LABELS, matchType)}
          </Badge>
          {pct !== null && (
            <span className="text-[11px] font-medium text-slate-500">%{pct} benzerlik</span>
          )}
        </div>
      </div>
    </li>
  );
}
