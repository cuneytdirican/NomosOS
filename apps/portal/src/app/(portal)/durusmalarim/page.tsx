"use client";

/**
 * Duruşmalarım — basit takvim görünümü: gün başlıklarıyla gruplanmış liste.
 *
 * Neden ay ızgarası değil? Müvekkilin duruşma sayısı azdır (yılda birkaç);
 * bir ay ızgarası boş kutularla dolar ve telefonda okunmaz. Gün başlıklı liste
 * hem tarih hissi verir hem dar ekranda çalışır.
 *
 * Yaklaşan duruşmalar üstte, geçmişler ayrı bir başlık altında ve ters sırada
 * (en yeni önce) listelenir.
 */

import { EP } from "@/lib/endpoints";
import { useListResource } from "@/lib/useResource";
import { fmtDayHeading, relativeDayLabel } from "@/lib/labels";
import type { PortalHearing } from "@/lib/types";
import { Badge, EmptyState, PageHeader, PrivacyNote, ResourceView } from "@/components/ui";
import { HearingCard } from "@/components/rows";

export default function HearingsPage() {
  const hearings = useListResource<PortalHearing>(EP.hearings);
  const { upcoming, past } = splitByTime(hearings.data);

  return (
    <div>
      <PageHeader
        title="Duruşmalarım"
        description="Dosyalarınızda planlanmış duruşma günleri. Tarihler mahkeme tarafından değiştirilebilir; değişiklikleri avukatınız buraya yansıtır."
      />

      <ResourceView
        loading={hearings.loading}
        missing={hearings.missing}
        forbidden={hearings.forbidden}
        error={hearings.error}
        empty={hearings.empty}
        endpoint={hearings.endpoint}
        onRetry={hearings.reload}
        loadingLabel="Duruşmalarınız getiriliyor…"
        emptyMessage="Paylaşılmış bir duruşma günü bulunmuyor."
        emptyHint="Yeni bir duruşma günü verildiğinde burada görünür."
      >
        <div className="space-y-10">
          <section>
            <h2 className="mb-4 font-serif text-lg font-semibold text-ink">
              Yaklaşan duruşmalar
            </h2>
            {upcoming.length > 0 ? (
              <DayGroups rows={upcoming} />
            ) : (
              <EmptyState message="Yaklaşan bir duruşmanız görünmüyor." />
            )}
          </section>

          {past.length > 0 && (
            <section>
              <h2 className="mb-4 font-serif text-lg font-semibold text-ink">
                Geçmiş duruşmalar
              </h2>
              <DayGroups rows={past} />
            </section>
          )}
        </div>
      </ResourceView>

      <div className="mt-8">
        <PrivacyNote />
      </div>
    </div>
  );
}

/** Gün başlıklarıyla gruplanmış liste. */
function DayGroups({ rows }: { rows: PortalHearing[] }) {
  const groups = groupByDay(rows);
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.key}>
          <div className="mb-3 flex flex-wrap items-baseline gap-3 border-b border-rule pb-2">
            <h3 className="font-serif text-[17px] font-semibold text-ink">{g.heading}</h3>
            {g.relative && <Badge tone="info">{g.relative}</Badge>}
          </div>
          <div className="space-y-4">
            {g.items.map((h) => (
              <HearingCard key={h.id} hearing={h} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function hearingTime(h: PortalHearing): number {
  const t = new Date(h.scheduledAt ?? h.date ?? "").getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Bugünün başlangıcı ölçüt alınır: sabah 09:30'daki bir duruşma, günün geri
 * kalanında "geçmiş" bölümüne düşmemelidir.
 */
function splitByTime(rows: PortalHearing[]): {
  upcoming: PortalHearing[];
  past: PortalHearing[];
} {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const threshold = startOfToday.getTime();

  const dated = rows.filter((h) => hearingTime(h) > 0);
  const upcoming = dated
    .filter((h) => hearingTime(h) >= threshold)
    .sort((a, b) => hearingTime(a) - hearingTime(b));
  const past = dated
    .filter((h) => hearingTime(h) < threshold)
    .sort((a, b) => hearingTime(b) - hearingTime(a));

  // Tarihi henüz belli olmayan kayıtlar yaklaşanların sonuna eklenir.
  const undated = rows.filter((h) => hearingTime(h) === 0);
  return { upcoming: [...upcoming, ...undated], past };
}

interface DayGroup {
  key: string;
  heading: string;
  relative: string | null;
  items: PortalHearing[];
}

function groupByDay(rows: PortalHearing[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const h of rows) {
    const when = h.scheduledAt ?? h.date;
    const heading = fmtDayHeading(when) ?? "Tarihi henüz belli değil";
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) {
      last.items.push(h);
      continue;
    }
    groups.push({
      key: `${heading}-${groups.length}`,
      heading,
      relative: relativeDayLabel(when),
      items: [h],
    });
  }
  return groups;
}
