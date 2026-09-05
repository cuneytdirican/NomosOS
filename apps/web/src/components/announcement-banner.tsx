"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Faz 2 — platform duyuru şeridi. `GET /notifications/announcements` (yayınlanmış,
 * süresi dolmamış, bu büroyu hedefleyen). Kapatma yerelde (localStorage) tutulur;
 * KRITIK duyurular her oturumda yeniden görünür.
 */
export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  severity: "BILGI" | "UYARI" | "KRITIK";
  publishedAt: string | null;
  expiresAt: string | null;
}

const DISMISS_KEY = "nomosos.duyuru.kapatilan";

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

const STYLES: Record<AnnouncementItem["severity"], string> = {
  BILGI: "border-sky-200 bg-sky-50 text-sky-900",
  UYARI: "border-amber-200 bg-amber-50 text-amber-900",
  KRITIK: "border-red-300 bg-red-50 text-red-900",
};
const LABELS: Record<AnnouncementItem["severity"], string> = { BILGI: "Duyuru", UYARI: "Uyarı", KRITIK: "Önemli" };

export function AnnouncementBanner() {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    setDismissed(readDismissed());
    api<{ items: AnnouncementItem[] }>("/notifications/announcements")
      .then((res) => setItems(res.items ?? []))
      .catch(() => setItems([]));
  }, []);

  const visible = items.filter((a) => a.severity === "KRITIK" || !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      /* yerel depolama kapalı — şerit yalnız bu oturumda gizlenir */
    }
  }

  return (
    <div className="space-y-2 print:hidden" data-testid="duyuru-seridi">
      {visible.map((a) => (
        <div key={a.id} role="status" className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${STYLES[a.severity]}`}>
          <span className="mt-0.5 shrink-0 rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
            {LABELS[a.severity]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{a.title}</p>
            <p className="mt-0.5 whitespace-pre-line">{a.body}</p>
          </div>
          {a.severity !== "KRITIK" && (
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              className="shrink-0 rounded px-2 py-0.5 text-xs opacity-70 hover:bg-white/60 hover:opacity-100"
              aria-label="Duyuruyu kapat"
            >
              Kapat
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
