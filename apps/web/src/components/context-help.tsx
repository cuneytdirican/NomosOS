"use client";

/**
 * BAĞLAMSAL YARDIM DÜĞMESİ (Modül 27) — üst çubuktan tüm sayfalarda çalışır.
 *
 * Gezilen yolun yardım konusunu bulur; açılır pencerede modülün detaylı özetini,
 * bölüm listesini (tek tıkla Yardım Merkezi'nde ilgili bölüme atlar) ve ilgili
 * sayfa bağlantılarını gösterir. Konu yoksa doğrudan Yardım Merkezi aramasına
 * götürür.
 */

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Modal } from "@/components/ui";
import { findHelpTopicForPath } from "@/lib/help-catalog";

export function ContextHelpButton() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const topic = useMemo(() => findHelpTopicForPath(pathname), [pathname]);

  function openSection(sectionId: string) {
    if (!topic) return;
    setOpen(false);
    router.push(`/app/yardim?konu=${topic.id}#${sectionId}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Bu sayfa için yardım"
        aria-label="Bu sayfa için yardım"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition-colors hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4.5 w-4.5">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-11.5a.75.75 0 0 0 1.5 0v-.75a.75.75 0 0 0-1.5 0v.75Zm.6 2.9a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5a.75.75 0 0 0-.75-.75Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={topic ? `${topic.title} — Yardım` : "Yardım"}>
        {topic ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-600">{topic.summary}</p>

            {topic.sections.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Konunun bölümleri
                </p>
                <ul className="space-y-1">
                  {topic.sections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        onClick={() => openSection(section.id)}
                        className="text-left text-sm font-medium text-slate-700 transition-colors hover:text-amber-700 hover:underline"
                      >
                        {section.heading} →
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {topic.links.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  İlgili sayfalara git
                </p>
                <div className="flex flex-wrap gap-2">
                  {topic.links.map((link) => (
                    <Button key={link.href + link.label} size="sm" variant="secondary" onClick={() => { setOpen(false); router.push(link.href); }}>
                      {link.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="border-t border-slate-100 pt-3">
              <Button
                size="sm"
                onClick={() => { setOpen(false); router.push(`/app/yardim?konu=${topic.id}`); }}
              >
                Yardım Merkezi'nde tam kılavuzu aç
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Bu sayfa için özel bir kılavuz kaydı yok. Yardım Merkezi'nde arama yapabilirsiniz.
            </p>
            <Button
              size="sm"
              onClick={() => { setOpen(false); router.push(`/app/yardim?sayfa=${encodeURIComponent(pathname)}`); }}
            >
              Yardım Merkezi'ne git
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
