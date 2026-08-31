"use client";

/**
 * Portal genelinde yeniden kullanılan satır/kart bileşenleri.
 *
 * Burada toplanmalarının sebebi tutarlılıktır: bir duruşma kartı ana sayfada,
 * dosya detayında ve duruşmalar sayfasında AYNI görünmeli; müvekkil aynı bilgiyi
 * üç farklı biçimde okumak zorunda kalmamalı.
 */

import { useState } from "react";
import Link from "next/link";
import {
  CASE_STATUS_EXPLAIN,
  CASE_STATUS_PLAIN,
  CASE_STATUS_TONES,
  DOCUMENT_CLASS_PLAIN,
  HEARING_STATUS_PLAIN,
  HEARING_STATUS_TONES,
  HEARING_TYPE_EXPLAIN,
  HEARING_TYPE_PLAIN,
  caseHeadline,
  firstOf,
  fmtBytes,
  fmtDate,
  fmtDateTime,
  fmtTime,
  plain,
  relativeDayLabel,
} from "@/lib/labels";
import type { PortalDocument, PortalHearing, PortalTimelineEntry } from "@/lib/types";
import { API_BASE, PORTAL_API_PREFIX, getToken } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { Badge } from "./ui";
import { Term, TermText } from "./Term";

// ---------------------------------------------------------------------------
// Dosya durumu rozeti — sade karşılık + açıklama baloncuğu
// ---------------------------------------------------------------------------

export function CaseStatusBadge({
  status,
  explainable = true,
}: {
  status?: string;
  /** Bağlantı içinde `false` verilir — iç içe etkileşimli öğe olmasın. */
  explainable?: boolean;
}) {
  if (!status) return null;
  const label = plain(CASE_STATUS_PLAIN, status, "Durum bilgisi bekleniyor");
  const explain = CASE_STATUS_EXPLAIN[status];
  const tone = CASE_STATUS_TONES[status] ?? "neutral";
  return (
    <Badge tone={tone} title={!explainable ? explain : undefined}>
      {explain && explainable ? (
        <Term explain={explain} term={label}>
          {label}
        </Term>
      ) : (
        label
      )}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Duruşma kartı
// ---------------------------------------------------------------------------

export function HearingCard({
  hearing,
  showCase = true,
}: {
  hearing: PortalHearing;
  showCase?: boolean;
}) {
  const when = hearing.scheduledAt ?? hearing.date;
  const typeLabel = plain(HEARING_TYPE_PLAIN, hearing.type, "Duruşma");
  const typeExplain = hearing.type ? HEARING_TYPE_EXPLAIN[hearing.type] : undefined;
  const court = firstOf(hearing.courtName, hearing.court);
  const relative = relativeDayLabel(when);
  const status = hearing.status;

  return (
    <article className="rounded-2xl border border-rule bg-white px-5 py-4 shadow-paper">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif text-lg font-semibold text-ink">
            {typeExplain ? (
              <Term explain={typeExplain} term={typeLabel}>
                {typeLabel}
              </Term>
            ) : (
              typeLabel
            )}
          </p>
          <p className="mt-1 text-[15px] text-ink-soft tnum">
            {fmtDate(when) ?? "Tarihi belirlenecek"}
            {fmtTime(when) ? ` · saat ${fmtTime(when)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {relative && <Badge tone="info">{relative}</Badge>}
          {status && (
            <Badge tone={HEARING_STATUS_TONES[status] ?? "neutral"}>
              {plain(HEARING_STATUS_PLAIN, status, "Planlandı")}
            </Badge>
          )}
        </div>
      </div>

      <dl className="mt-3 space-y-1 text-[15px] text-ink-soft">
        {court && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-faint">Mahkeme:</dt>
            <dd className="text-ink">{court}</dd>
          </div>
        )}
        {hearing.courtRoom && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-faint">Duruşma salonu:</dt>
            <dd className="text-ink">{hearing.courtRoom}</dd>
          </div>
        )}
        {showCase && (hearing.caseFileNumber || hearing.caseTitle) && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-faint">Dosya:</dt>
            <dd className="text-ink">
              {hearing.caseId ? (
                <Link
                  href={`/dosyalarim/${hearing.caseId}`}
                  className="underline underline-offset-4 hover:text-gold-deep"
                >
                  {caseHeadline({
                    fileNumber: hearing.caseFileNumber,
                    title: hearing.caseTitle,
                  })}
                </Link>
              ) : (
                caseHeadline({
                  fileNumber: hearing.caseFileNumber,
                  title: hearing.caseTitle,
                })
              )}
            </dd>
          </div>
        )}
      </dl>

      {hearing.clientAttendanceRequired && (
        <p className="mt-3 rounded-xl bg-calm-amberSoft px-4 py-2.5 text-[15px] text-calm-amber">
          Bu duruşmada sizin de hazır bulunmanız gerekiyor.
        </p>
      )}

      {hearing.resultSummary && (
        <p className="mt-3 max-w-reading text-[15px] leading-relaxed text-ink">
          <TermText text={hearing.resultSummary} />
        </p>
      )}

      {hearing.note && !hearing.resultSummary && (
        <p className="mt-3 max-w-reading text-[15px] leading-relaxed text-ink-soft">
          <TermText text={hearing.note} />
        </p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Belge satırı + indirme
// ---------------------------------------------------------------------------

export function DocumentRow({
  doc,
  showCase = true,
}: {
  doc: PortalDocument;
  showCase?: boolean;
}) {
  const name = firstOf(doc.name, doc.fileName, doc.title) ?? "Belge";
  const kind = doc.documentClass
    ? plain(DOCUMENT_CLASS_PLAIN, doc.documentClass, "Belge")
    : null;
  const shared = fmtDate(doc.publishedAt ?? doc.createdAt);
  const size = fmtBytes(doc.sizeBytes);

  return (
    <article className="flex flex-wrap items-center justify-between gap-4 border-b border-rule/60 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink">{name}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-faint">
          {kind && (
            <span>
              <Term term={kind.toLocaleLowerCase("tr-TR")}>{kind}</Term>
            </span>
          )}
          {shared && <span>· {shared} tarihinde paylaşıldı</span>}
          {size && <span>· {size}</span>}
        </p>
        {showCase && (doc.caseFileNumber || doc.caseTitle) && (
          <p className="mt-1 text-sm text-ink-soft">
            {doc.caseId ? (
              <Link
                href={`/dosyalarim/${doc.caseId}`}
                className="underline underline-offset-4 hover:text-gold-deep"
              >
                {caseHeadline({ fileNumber: doc.caseFileNumber, title: doc.caseTitle })}
              </Link>
            ) : (
              caseHeadline({ fileNumber: doc.caseFileNumber, title: doc.caseTitle })
            )}
          </p>
        )}
      </div>
      <DownloadButton doc={doc} />
    </article>
  );
}

/**
 * Belge indirme.
 *
 * Uç iki biçimde yanıt verebilir:
 *   1. `{ url: "https://…" }` — imzalı ve süreli adres (spec'in tercih ettiği yol)
 *   2. doğrudan dosya akışı — yanıt blob olarak indirilir
 *
 * İstek `Authorization` başlığıyla gider; bu yüzden basit bir `<a href>` yeterli
 * değildir. Hata hâlinde müvekkile teknik kod değil, ne yapacağı yazılır.
 */
function DownloadButton({ doc }: { doc: PortalDocument }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      if (doc.downloadUrl) {
        window.open(doc.downloadUrl, "_blank", "noopener,noreferrer");
        return;
      }
      const token = getToken();
      const res = await fetch(`${API_BASE}${PORTAL_API_PREFIX}${EP.documentDownload(doc.id)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setError("Belge şu anda indirilemedi. Kısa süre sonra tekrar deneyin.");
        return;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = (await res.json()) as { url?: string };
        if (payload?.url) {
          window.open(payload.url, "_blank", "noopener,noreferrer");
          return;
        }
        setError("Belge şu anda indirilemedi. Kısa süre sonra tekrar deneyin.");
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = firstOf(doc.fileName, doc.name, doc.title) ?? "belge";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Tarayıcının indirmeyi başlatmasına zaman tanınır, sonra bellek bırakılır.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch {
      setError("Belge şu anda indirilemedi. İnternet bağlantınızı kontrol edin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl border border-rule bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper-alt disabled:cursor-not-allowed disabled:text-ink-faint"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path d="M10 2.5a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V3.25A.75.75 0 0 1 10 2.5Z" />
          <path d="M3.5 13.5a.75.75 0 0 1 .75.75v1.25h11.5V14.25a.75.75 0 0 1 1.5 0v1.5a1.25 1.25 0 0 1-1.25 1.25H4.25A1.25 1.25 0 0 1 3 15.75v-1.5a.75.75 0 0 1 .5-.75Z" />
        </svg>
        {busy ? "Hazırlanıyor…" : "İndir"}
      </button>
      {error && <p className="mt-1.5 max-w-[16rem] text-sm text-calm-rose">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Son gelişmeler (safahat)
// ---------------------------------------------------------------------------

export function TimelineList({ entries }: { entries: PortalTimelineEntry[] }) {
  const sorted = [...entries].sort(
    (a, b) => entryTime(b) - entryTime(a),
  );

  return (
    <ol className="relative space-y-6 border-l border-rule pl-6">
      {sorted.map((e) => {
        const when = e.occurredAt ?? e.date ?? e.publishedAt;
        // Gövde metni özet/açıklamadan gelir. İkisi de yoksa başlık gövde olur;
        // böylece başlıksız da başlıklı da kayıtlar aynı düzende okunur.
        const body = firstOf(e.summary, e.description);
        const heading = body ? firstOf(e.title) : null;
        const text = body ?? firstOf(e.title);
        return (
          <li key={e.id} className="relative">
            <span
              aria-hidden="true"
              className="absolute -left-[1.9rem] top-2 h-2.5 w-2.5 rounded-full bg-gold ring-4 ring-paper"
            />
            <p className="text-sm font-medium text-gold-deep tnum">
              {fmtDate(when) ?? "Tarih belirtilmemiş"}
            </p>
            {heading && (
              <p className="mt-1 text-[15px] font-medium text-ink">
                <TermText text={heading} />
              </p>
            )}
            {text && (
              <p className="mt-1 max-w-reading text-[15px] leading-relaxed text-ink-soft">
                <TermText text={text} />
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function entryTime(e: PortalTimelineEntry): number {
  const t = new Date(e.occurredAt ?? e.date ?? e.publishedAt ?? "").getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Son gelişme özetinin bir satırlık hâli — dosya listesi kartında kullanılır. */
export function LatestUpdateLine({
  entries,
  fallback,
  interactive = true,
}: {
  entries?: PortalTimelineEntry[];
  fallback?: string | null;
  /** Bağlantı içinde `false` verilir (bkz. `Term`). */
  interactive?: boolean;
}) {
  const latest =
    entries && entries.length > 0
      ? [...entries].sort((a, b) => entryTime(b) - entryTime(a))[0]
      : null;
  const text = latest ? firstOf(latest.summary, latest.description, latest.title) : fallback;
  if (!text) return null;
  const when = latest ? fmtDate(latest.occurredAt ?? latest.date ?? latest.publishedAt) : null;
  return (
    <p className="mt-3 max-w-reading text-[15px] leading-relaxed text-ink-soft">
      {when && <span className="mr-2 font-medium text-gold-deep tnum">{when}</span>}
      <TermText text={text} interactive={interactive} />
    </p>
  );
}

/** Yayınlanma zamanını gösteren küçük not — "12 Ağustos 2026'da paylaşıldı". */
export function PublishedNote({ at }: { at?: string | null }) {
  const label = fmtDateTime(at);
  if (!label) return null;
  return <p className="text-sm text-ink-faint">{label} tarihinde paylaşıldı</p>;
}
