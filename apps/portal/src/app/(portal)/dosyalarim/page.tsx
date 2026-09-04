"use client";

/**
 * Dosyalarım — yayınlanmış dosyaların listesi.
 *
 * Liste yalnızca avukatın portala YAYINLADIĞI dosyaları içerir. Yayınlanmamış
 * bir dosya bu listede görünmez ve id'si tahmin edilerek de açılamaz (API 404).
 * Bu yüzden boş liste bir arıza değil, bir yayın kararıdır ve ekran öyle anlatır.
 */

import Link from "next/link";
import { EP } from "@/lib/endpoints";
import { useListResource } from "@/lib/useResource";
import {
  CASE_TYPE_PLAIN,
  caseHeadline,
  firstOf,
  fmtDate,
  plain,
  relativeDayLabel,
} from "@/lib/labels";
import type { PortalCase } from "@/lib/types";
import { Badge, PageHeader, PrivacyNote, ResourceView } from "@/components/ui";
import { CaseStatusBadge, LatestUpdateLine } from "@/components/rows";

export default function CasesPage() {
  const cases = useListResource<PortalCase>(EP.cases);

  return (
    <div>
      <PageHeader
        title="Dosyalarım"
        description="Avukatınızın sizinle paylaştığı dosyalar ve güncel durumları."
      />

      <ResourceView
        loading={cases.loading}
        missing={cases.missing}
        forbidden={cases.forbidden}
        error={cases.error}
        empty={cases.empty}
        endpoint={cases.endpoint}
        onRetry={cases.reload}
        loadingLabel="Dosyalarınız getiriliyor…"
        emptyMessage="Avukatınız henüz sizinle bir dosya paylaşmadı."
        emptyHint="Bir dosya portalda görünür hâle geldiğinde burada listelenir."
      >
        <ul className="space-y-4">
          {cases.data.map((c) => (
            <li key={c.id}>
              <CaseCard item={c} />
            </li>
          ))}
        </ul>
      </ResourceView>

      <div className="mt-8">
        <PrivacyNote />
      </div>
    </div>
  );
}

function CaseCard({ item }: { item: PortalCase }) {
  const court = firstOf(item.courtName, item.court);
  // Liste ucu duruşma NESNESİ değil, en yakın yayınlanmış duruşma TARİHİNİ
  // döndürür (nextPublishedHearingAt); ayrıca avukatın yayın notu gelir.
  const nextWhen = item.nextHearing
    ? (item.nextHearing.scheduledAt ?? item.nextHearing.date)
    : (item.nextPublishedHearingAt ?? null);

  return (
    <Link
      href={`/dosyalarim/${item.id}`}
      className="block rounded-2xl border border-rule bg-white px-6 py-5 shadow-paper transition-transform hover:-translate-y-0.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-lg font-semibold leading-snug text-ink">
            {caseHeadline(item)}
          </h2>
          {court && <p className="mt-1 text-[15px] text-ink-soft">{court}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.type && (
            <Badge tone="neutral">{plain(CASE_TYPE_PLAIN, item.type, "Dosya")}</Badge>
          )}
          {/* Kartın tamamı bir bağlantıdır: içeride etkileşimli açıklama
              baloncuğu KURULMAZ (geçersiz HTML + yanlışlıkla gezinme). Terim
              açıklamaları dosya detayında verilir. */}
          <CaseStatusBadge status={item.status} explainable={false} />
        </div>
      </div>

      <LatestUpdateLine
        entries={item.timeline}
        fallback={firstOf(item.publicationNote, item.statusSummary, item.summary)}
        interactive={false}
      />

      {nextWhen && (
        <p className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-xl bg-paper-alt/70 px-4 py-2 text-[15px] text-ink">
          <span className="font-medium">Yaklaşan duruşma:</span>
          <span className="tnum">{fmtDate(nextWhen)}</span>
          {relativeDayLabel(nextWhen) && (
            <span className="text-ink-soft">({relativeDayLabel(nextWhen)})</span>
          )}
        </p>
      )}

      <p className="mt-4 text-sm font-medium text-gold-deep">Dosyayı aç →</p>
    </Link>
  );
}
