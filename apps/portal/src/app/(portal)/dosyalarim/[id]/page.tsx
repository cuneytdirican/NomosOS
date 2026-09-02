"use client";

/**
 * Dosya detayı — müvekkil gözüyle.
 *
 * BÖLÜM SIRASI, müvekkilin sorularının sırasıdır:
 *   1. "Dosyam ne durumda?"      → sade dille durum + avukatın yayınladığı özet
 *   2. "Kimler taraf?"           → taraflar (kendisi işaretli)
 *   3. "Ne zaman duruşma var?"   → yaklaşan duruşma
 *   4. "Son ne oldu?"            → son gelişmeler (safahat, sade dille)
 *   5. "Hangi belgeler var?"     → paylaşılan belgeler
 *
 * Dosya numarası ve mahkeme adı en üstte görünür: müvekkil adliyede veya
 * telefonda bu iki bilgiyi sorulduğunda hazır bulmalıdır.
 *
 * React 19 / Next 15: `params` bir Promise'tır ve `use()` ile çözülür.
 */

import { use } from "react";
import Link from "next/link";
import { EP } from "@/lib/endpoints";
import { useListResource, useResource } from "@/lib/useResource";
import {
  CASE_STATUS_EXPLAIN,
  CASE_TYPE_PLAIN,
  PARTY_ROLE_PLAIN,
  firstOf,
  fmtDate,
  plain,
} from "@/lib/labels";
import type { PortalCase, PortalDocument, PortalTimelineEntry } from "@/lib/types";
import {
  Badge,
  Card,
  DataRow,
  EmptyState,
  PrivacyNote,
  ResourceView,
} from "@/components/ui";
import {
  CaseStatusBadge,
  DocumentRow,
  HearingCard,
  TimelineList,
} from "@/components/rows";
import { TermText } from "@/components/Term";

export default function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const detail = useResource<PortalCase>(EP.case(id));
  const item = detail.data;

  // Safahat ve belgeler detay yanıtının içinde gelebilir; gelmiyorsa kendi
  // uçlarından çekilir. `path: null` iken istek atılmaz.
  const needTimeline = Boolean(item) && !item?.timeline;
  const timeline = useListResource<PortalTimelineEntry>(
    // `/cases/:id/timeline` diye bir uç YOKTUR; safahat, dosya süzgeciyle
    // ortak uçtan gelir. Detay yanıtı zaten `timeline` taşıdığı için bu yol
    // pratikte kullanılmaz, ama var olan bir uca işaret etmelidir.
    needTimeline ? EP.timeline : null,
    { query: { caseId: id } },
  );

  const needDocuments = Boolean(item) && !item?.documents;
  const documents = useListResource<PortalDocument>(
    needDocuments ? EP.documents : null,
    { query: { caseId: id } },
  );

  return (
    <div>
      <Link
        href="/dosyalarim"
        className="mb-5 inline-block text-[15px] font-medium text-ink-soft underline underline-offset-4 hover:text-gold-deep"
      >
        ← Dosyalarım
      </Link>

      <ResourceView
        loading={detail.loading}
        missing={detail.missing}
        forbidden={detail.forbidden}
        error={detail.error}
        empty={detail.loaded && !item}
        endpoint={detail.endpoint}
        onRetry={detail.reload}
          loadingLabel="Dosya bilgileri getiriliyor…"
          emptyMessage="Bu dosya portalda yayında değil."
          emptyHint="Dosya henüz sizinle paylaşılmamış ya da paylaşımı avukatınız tarafından kaldırılmış olabilir. Dosya listesinden görünür dosyalarınıza göz atın."
      >
        {item && (
          <CaseDetail
            item={item}
            timeline={item.timeline ?? (timeline.loaded ? timeline.data : null)}
            timelineLoading={needTimeline && timeline.loading}
            documents={item.documents ?? (documents.loaded ? documents.data : null)}
            documentsLoading={needDocuments && documents.loading}
          />
        )}
      </ResourceView>

      <div className="mt-8">
        <PrivacyNote />
      </div>
    </div>
  );
}

function CaseDetail({
  item,
  timeline,
  timelineLoading,
  documents,
  documentsLoading,
}: {
  item: PortalCase;
  timeline: PortalTimelineEntry[] | null;
  timelineLoading: boolean;
  documents: PortalDocument[] | null;
  documentsLoading: boolean;
}) {
  const court = firstOf(item.courtName, item.court);
  const fileNo = firstOf(item.fileNumber, item.caseNumber);
  const statusExplain = item.status ? CASE_STATUS_EXPLAIN[item.status] : undefined;
  const publishedSummary = firstOf(item.statusSummary, item.summary);
  const parties = item.parties ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-ink sm:text-[2rem]">
          {firstOf(item.title, item.subject) ?? "Dosyanız"}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.type && (
            <Badge tone="neutral">{plain(CASE_TYPE_PLAIN, item.type, "Dosya")}</Badge>
          )}
          <CaseStatusBadge status={item.status} />
        </div>
      </header>

      <Card title="Dosya bilgileri">
        <dl>
          <DataRow label="Dosya numarası">
            {fileNo ? <span className="tnum font-medium">{fileNo}</span> : null}
          </DataRow>
          <DataRow label="Mahkeme">{court}</DataRow>
          <DataRow label="Dosyanın açılış tarihi">{fmtDate(item.openedAt)}</DataRow>
          <DataRow label="Sorumlu avukatınız">{item.lawyerName}</DataRow>
        </dl>
        {!fileNo && !court && (
          <p className="text-[15px] text-ink-soft">
            Dosya numarası ve mahkeme bilgisi henüz paylaşılmadı.
          </p>
        )}
      </Card>

      <Card
        title="Dosyanız şu anda"
        subtitle="Avukatınızın sizin için hazırladığı güncel durum açıklaması."
      >
        {statusExplain && (
          <p className="max-w-reading text-[15px] leading-relaxed text-ink">
            {statusExplain}
          </p>
        )}
        {publishedSummary ? (
          <p
            className={`max-w-reading text-[15px] leading-relaxed text-ink ${
              statusExplain ? "mt-4 border-t border-rule/60 pt-4" : ""
            }`}
          >
            <TermText text={publishedSummary} />
          </p>
        ) : (
          !statusExplain && (
            <EmptyState message="Avukatınız bu dosya için henüz bir durum açıklaması paylaşmadı." />
          )
        )}
      </Card>

      {parties.length > 0 && (
        <Card title="Taraflar" subtitle="Dosyada yer alan kişi ve kurumlar.">
          <ul className="divide-y divide-rule/60">
            {parties.map((p, i) => (
              <li
                key={p.id ?? `${p.name}-${i}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="text-[15px] text-ink">
                  {p.name ?? "—"}
                  {p.isSelf && (
                    <span className="ml-2 text-sm font-medium text-gold-deep">(siz)</span>
                  )}
                </span>
                {p.role && (
                  <Badge tone="neutral">
                    {plain(PARTY_ROLE_PLAIN, p.role, "İlgili taraf")}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {item.nextHearing && (
        <section>
          <h2 className="mb-3 font-serif text-lg font-semibold text-ink">
            Yaklaşan duruşma
          </h2>
          <HearingCard hearing={item.nextHearing} showCase={false} />
        </section>
      )}

      <Card
        title="Son gelişmeler"
        subtitle="Dosyanızda yapılan işlemler, sade dille ve tarih sırasıyla."
      >
        {timelineLoading ? (
          <p className="text-[15px] text-ink-faint">Gelişmeler getiriliyor…</p>
        ) : timeline && timeline.length > 0 ? (
          <TimelineList entries={timeline} />
        ) : (
          <EmptyState message="Avukatınız henüz bu dosyada bir gelişme paylaşmadı." />
        )}
      </Card>

      <Card
        title="Paylaşılan belgeler"
        subtitle="Yalnızca avukatınızın sizinle paylaştığı belgeler görünür."
      >
        {documentsLoading ? (
          <p className="text-[15px] text-ink-faint">Belgeler getiriliyor…</p>
        ) : documents && documents.length > 0 ? (
          <div>
            {documents.map((d) => (
              <DocumentRow key={d.id} doc={d} showCase={false} />
            ))}
          </div>
        ) : (
          <EmptyState message="Bu dosyada sizinle paylaşılmış bir belge bulunmuyor." />
        )}
      </Card>

      <p className="text-sm leading-relaxed text-ink-faint">
        Dosya numaranız{fileNo ? ` (${fileNo})` : ""} ve mahkeme adı, adliyede veya
        telefonda dosyanızı sorarken kullanacağınız bilgilerdir. Anlamadığınız bir
        ifade olursa avukatınıza <Link href="/mesajlar" className="underline underline-offset-4">mesaj yazabilirsiniz</Link>.
      </p>
    </div>
  );
}
