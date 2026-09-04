"use client";

/**
 * YARDIM MERKEZİ (Modül 27) — aranabilir yardım uygulaması.
 *
 * - Arama: katalog üzerinde başlık/özet/gövde/etiket (istemci tarafı, uç gerektirmez).
 * - Sonuç → konu → bölüm: `?konu=<id>#<bolum-id>` adresiyle bölüme tek tıkla gidilir.
 * - Sayfa açılışında çapa varsa ilgili bölüme kaydırılır ve bölüm vurgulanır.
 * - Bağlamsal giriş: `?sayfa=<yol>` ile gelindiyse o yolun konusu öne çıkarılır.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input } from "@/components/ui";
import {
  HELP_TOPICS,
  findHelpTopicForPath,
  searchHelpTopics,
  type HelpTopic,
} from "@/lib/help-catalog";

interface QueryParams {
  q: string;
  konu: string;
  sayfa: string;
}

function readQuery(): QueryParams {
  if (typeof window === "undefined") return { q: "", konu: "", sayfa: "" };
  const p = new URLSearchParams(window.location.search);
  return { q: p.get("q") ?? "", konu: p.get("konu") ?? "", sayfa: p.get("sayfa") ?? "" };
}

export default function YardimPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeTopic, setActiveTopic] = useState<HelpTopic | null>(null);
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // İlk değerler URL'den (SSR'sız, prerender güvenli).
  useEffect(() => {
    const { q, konu, sayfa } = readQuery();
    if (q) setQuery(q);
    if (konu) {
      const topic = HELP_TOPICS.find((t) => t.id === konu) ?? null;
      if (topic) setActiveTopic(topic);
    } else if (sayfa) {
      const topic = findHelpTopicForPath(sayfa);
      if (topic) {
        setActiveTopic(topic);
        setContextNotice(`"${topic.title}" sayfasından yardım istediniz — ilgili konu aşağıda.`);
      }
    }
  }, []);

  // Çapa ile gelindiyse bölüme kaydır ve vurgula.
  useEffect(() => {
    if (!activeTopic) return;
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlight(hash);
      const timer = window.setTimeout(() => setHighlight(null), 2400);
      return () => window.clearTimeout(timer);
    }
  }, [activeTopic]);

  const results = useMemo(() => searchHelpTopics(query), [query]);

  const openTopic = useCallback(
    (topic: HelpTopic, sectionId?: string, replace = false) => {
      setActiveTopic(topic);
      setContextNotice(null);
      const url = sectionId
        ? `/app/yardim?konu=${topic.id}#${sectionId}`
        : `/app/yardim?konu=${topic.id}`;
      if (replace) router.replace(url);
      else router.push(url);
      if (sectionId) {
        // Konu değişince DOM hazır olduktan sonra kaydır.
        window.setTimeout(() => {
          const el = document.getElementById(sectionId);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            setHighlight(sectionId);
            window.setTimeout(() => setHighlight(null), 2400);
          }
        }, 60);
      } else {
        window.scrollTo({ top: 0 });
      }
    },
    [router],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Yardım Merkezi</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tüm modüllerin kullanım kılavuzu. Arayın, sonuca gidin, bölüme tek tıkla atlayın.
          </p>
        </div>
        {activeTopic ? (
          <Button variant="secondary" onClick={() => { setActiveTopic(null); setContextNotice(null); router.replace(query ? `/app/yardim?q=${encodeURIComponent(query)}` : "/app/yardim"); }}>
            ← Tüm konular
          </Button>
        ) : null}
      </div>

      <Card>
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0 text-slate-500">
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
              clipRule="evenodd"
            />
          </svg>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ara: süre, içtihat, kredi, İSG, dilekçe, sağlayıcı…"
            aria-label="Yardım içinde ara"
          />
        </div>
        {query ? (
          <p className="mt-2 text-xs text-slate-500">
            {results.length > 0
              ? `${results.length} konu bulundu.`
              : "Sonuç yok. Daha kısa bir terim deneyin (örn. 'süre', 'ai')."}
          </p>
        ) : null}
      </Card>

      {contextNotice ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {contextNotice}
        </p>
      ) : null}

      {activeTopic ? (
        <TopicDetail topic={activeTopic} highlight={highlight} onOpenSection={openTopic} />
      ) : (
        <div ref={listRef} className="space-y-3">
          {(query ? results : HELP_TOPICS).map((topic) => (
            <button
              key={topic.id}
              type="button"
              onClick={() => openTopic(topic)}
              className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-amber-400 hover:bg-amber-50/50"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-slate-900">{topic.title}</p>
                <Badge tone="gray">{topic.sections.length} bölüm</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{topic.summary}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TopicDetail({
  topic,
  highlight,
  onOpenSection,
}: {
  topic: HelpTopic;
  highlight: string | null;
  onOpenSection: (topic: HelpTopic, sectionId: string, replace?: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">{topic.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{topic.summary}</p>
        {topic.links.length > 0 ? (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              İlgili sayfalar
            </p>
            <div className="flex flex-wrap gap-2">
              {topic.links.map((link) => (
                <Link
                  key={link.href + link.label}
                  href={link.href}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-amber-400 hover:bg-amber-50"
                >
                  {link.label} →
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <nav className="rounded-xl border border-slate-200 bg-white px-4 py-3" aria-label="Konu bölümleri">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bölümler</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {topic.sections.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => onOpenSection(topic, section.id, true)}
                className="text-left text-sm text-slate-600 transition-colors hover:text-amber-700 hover:underline"
              >
                {section.heading}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {topic.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className={`scroll-mt-24 rounded-xl border px-4 py-4 transition-colors ${
            highlight === section.id
              ? "border-amber-400 bg-amber-50"
              : "border-slate-200 bg-white"
          }`}
        >
          <h3 className="font-semibold text-slate-900">{section.heading}</h3>
          <div className="mt-2 space-y-2">
            {section.body.map((paragraph, i) => (
              <p key={i} className="text-sm leading-relaxed text-slate-600">
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
