"use client";

/**
 * Birleşik iletişim kronolojisi (Modül 19).
 *
 * ÜÇ SATIR TÜRÜ TEK LİSTEDE ama GÖRSEL OLARAK AYRIK durur:
 *  - GİDEN  → onay/gönderim durumu rozetiyle; onaysız metin "TASLAK" damgalıdır,
 *  - GELEN  → eşleştirme durumu ve (varsa) AI dosya önerisiyle,
 *  - LOG    → telefon/yüz yüze gibi elle işlenmiş kayıt.
 *
 * Onaylanmamış bir giden mesajın gövdesi "gönderilmiş" gibi görünmemelidir:
 * bu yüzden taslak gövdeler kesikli çerçeveyle ve "henüz gönderilmedi"
 * satırıyla çizilir. Kronolojide "ne önerildi" ile "ne gönderildi" ayrımı,
 * ürünün onay akışı vaadinin ekrandaki karşılığıdır.
 */

import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import {
  COMM_CHANNEL_ICONS,
  COMM_CHANNEL_LABELS,
  COMM_DIRECTION_LABELS,
  COMM_DIRECTION_TONES,
  MATCH_STATUS_LABELS,
  MATCH_STATUS_TONES,
  OUTBOUND_STATUS_LABELS,
  OUTBOUND_STATUS_TONES,
  fmtDayHeading,
  fmtTime,
  labelOf,
  toIsoDate,
} from "@/lib/labels";
import type { CommEntry } from "../_lib/faz5-types";

/** Kronolojiyi takvim gününe göre gruplar (yeniden eskiye). */
export function groupCommByDay(entries: CommEntry[]): Array<[string, CommEntry[]]> {
  const map = new Map<string, CommEntry[]>();
  const sorted = [...entries].sort((a, b) =>
    String(b.occurredAt ?? "").localeCompare(String(a.occurredAt ?? "")),
  );
  for (const e of sorted) {
    const d = e.occurredAt ? new Date(e.occurredAt) : null;
    const key = d && !Number.isNaN(d.getTime()) ? toIsoDate(d) : "—";
    const bucket = map.get(key);
    if (bucket) bucket.push(e);
    else map.set(key, [e]);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function ChannelChip({ channel }: { channel: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
      title={labelOf(COMM_CHANNEL_LABELS, channel)}
    >
      <span aria-hidden="true">{COMM_CHANNEL_ICONS[channel] ?? "📎"}</span>
      {labelOf(COMM_CHANNEL_LABELS, channel)}
    </span>
  );
}

export function CommEntryRow({
  entry,
  showClient = true,
  showCase = true,
  onOpen,
}: {
  entry: CommEntry;
  showClient?: boolean;
  showCase?: boolean;
  /** Giden taslakta "Onay ekranını aç" — verilmezse düğme çıkmaz. */
  onOpen?: (entry: CommEntry) => void;
}) {
  const isDraft =
    entry.kind === "GIDEN" && (entry.status === "TASLAK" || entry.status === "ONAY_BEKLIYOR");
  const isIncoming = entry.kind === "GELEN";

  return (
    <li
      className={`rounded-lg border px-3 py-2.5 ${
        isDraft
          ? "border-dashed border-amber-300 bg-amber-50/50"
          : isIncoming
            ? "border-slate-200 bg-blue-50/30"
            : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tabular-nums text-slate-500">
              {fmtTime(entry.occurredAt)}
            </span>
            <ChannelChip channel={entry.channel} />
            <Badge tone={COMM_DIRECTION_TONES[entry.direction] ?? "gray"}>
              {labelOf(COMM_DIRECTION_LABELS, entry.direction)}
            </Badge>
            {entry.kind === "GIDEN" && entry.status && (
              <Badge tone={OUTBOUND_STATUS_TONES[entry.status] ?? "gray"}>
                {labelOf(OUTBOUND_STATUS_LABELS, entry.status)}
              </Badge>
            )}
            {entry.kind === "GELEN" && entry.matchStatus && (
              <Badge tone={MATCH_STATUS_TONES[entry.matchStatus] ?? "gray"}>
                {labelOf(MATCH_STATUS_LABELS, entry.matchStatus)}
              </Badge>
            )}
          </div>

          {entry.subject && (
            <p className="mt-1.5 text-sm font-medium text-slate-900">{entry.subject}</p>
          )}
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">
            {entry.body.length > 420 ? `${entry.body.slice(0, 420)}…` : entry.body || "(boş metin)"}
          </p>

          <p className="mt-1.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
            {showClient && entry.client && (
              <Link
                href={`/app/muvekkiller/${entry.client.id}`}
                className="hover:text-amber-600"
              >
                {entry.client.name ?? "Müvekkil"}
              </Link>
            )}
            {showCase && entry.case && (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  href={`/app/dosyalar/${entry.case.id}`}
                  className="hover:text-amber-600"
                >
                  {entry.case.title ?? entry.case.fileNumber ?? "Dosya"}
                </Link>
              </>
            )}
            {entry.fromRef && (
              <>
                <span aria-hidden="true">·</span>
                <span>{entry.fromRef}</span>
              </>
            )}
            {entry.contactRef && (
              <>
                <span aria-hidden="true">·</span>
                <span>{entry.contactRef}</span>
              </>
            )}
          </p>

          {isDraft && (
            <p className="mt-2 text-[11px] font-medium text-amber-800">
              Bu metin HENÜZ GÖNDERİLMEDİ. Avukat onayı olmadan müvekkile ulaşmaz.
            </p>
          )}
          {entry.kind === "GIDEN" && entry.status === "BASARISIZ" && entry.failureReason && (
            <p className="mt-2 text-[11px] font-medium text-red-700">
              Gönderim hatası: {entry.failureReason}
            </p>
          )}
        </div>

        {onOpen && entry.kind === "GIDEN" && entry.status !== "GONDERILDI" && (
          <button
            type="button"
            onClick={() => onOpen(entry)}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {isDraft ? "İncele ve onayla" : "Aç"}
          </button>
        )}
      </div>
    </li>
  );
}

export function CommTimeline({
  entries,
  title = "İletişim Kronolojisi",
  emptyMessage = "Bu aralıkta kayıtlı yazışma yok.",
  showClient = true,
  showCase = true,
  action,
  onOpen,
}: {
  entries: CommEntry[];
  title?: string;
  emptyMessage?: string;
  showClient?: boolean;
  showCase?: boolean;
  action?: React.ReactNode;
  onOpen?: (entry: CommEntry) => void;
}) {
  const days = groupCommByDay(entries);

  return (
    <Card title={`${title} (${entries.length})`} action={action}>
      {entries.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="space-y-5">
          {days.map(([day, items]) => (
            <div key={day}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {day === "—" ? "Tarihsiz" : fmtDayHeading(items[0].occurredAt)}
              </p>
              <ul className="space-y-2">
                {items.map((e) => (
                  <CommEntryRow
                    key={`${e.kind}-${e.id}`}
                    entry={e}
                    showClient={showClient}
                    showCase={showCase}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
