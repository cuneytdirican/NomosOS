"use client";

/**
 * Ctrl+K / ⌘K komut paleti (Faz 7B).
 *
 * İki kaynak: (1) menü kısayolları (yerel, anında), (2) sunucu global araması
 * (`GET /search` — dosya, müvekkil, belge, görev, süre, duruşma, dilekçe; görünürlük
 * kuralları sunucuda). Klavye: ↑/↓ gezinme, Enter aç, Esc kapat.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export interface PaletteShortcut {
  label: string;
  href: string;
  group: string;
}

interface SearchHit {
  kind: string;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

interface SearchGroup {
  kind: string;
  label: string;
  items: SearchHit[];
}

interface Row {
  key: string;
  title: string;
  subtitle: string | null;
  href: string;
  group: string;
}

function foldTr(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
}

export function CommandPalette({ shortcuts }: { shortcuts: PaletteShortcut[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setGroups([]);
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      api<{ groups: SearchGroup[] }>("/search", { query: { q: term, limit: "5" } })
        .then((res) => {
          if (reqRef.current === id) setGroups(res.groups ?? []);
        })
        .catch(() => {
          if (reqRef.current === id) setGroups([]);
        })
        .finally(() => {
          if (reqRef.current === id) setLoading(false);
        });
    }, 220);
    return () => window.clearTimeout(t);
  }, [q, open]);

  const rows = useMemo<Row[]>(() => {
    const term = foldTr(q.trim());
    const local = shortcuts
      .filter((s) => !term || foldTr(s.label).includes(term))
      .slice(0, term ? 5 : 8)
      .map((s) => ({ key: `nav:${s.href}`, title: s.label, subtitle: s.group, href: s.href, group: "Git" }));
    const remote = groups.flatMap((g) => g.items.map((i) => ({ key: `${g.kind}:${i.id}`, title: i.title, subtitle: i.subtitle, href: i.href, group: g.label })));
    return [...remote, ...local];
  }, [q, shortcuts, groups]);

  useEffect(() => {
    setActive(0);
  }, [rows.length, q]);

  const go = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      setOpen(false);
      router.push(row.href);
    },
    [router],
  );

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-[12vh]" onMouseDown={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Komut paleti">
      <div className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-slate-500" aria-hidden="true">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
          </svg>
          <input
            ref={inputRef}
            data-testid="komut-paleti-arama"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(rows.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(rows[active]);
              }
            }}
            placeholder="Dosya, müvekkil, belge, görev ara… ya da bir sayfaya git"
            className="flex-1 border-0 bg-transparent text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
            autoComplete="off"
          />
          {loading && <span className="text-[11px] text-slate-500">aranıyor…</span>}
          <kbd className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600">Esc</kbd>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1" role="listbox">
          {rows.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-500">{q.trim().length < 2 ? "Aramak için en az iki karakter yazın." : loading ? "Aranıyor…" : "Sonuç yok."}</li>
          )}
          {rows.map((row, i) => {
            const header = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            return (
              <li key={row.key} role="option" aria-selected={i === active}>
                {header && <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{header}</p>}
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(row)}
                  className={`flex w-full items-start justify-between gap-3 px-4 py-2 text-left ${i === active ? "bg-amber-50" : "hover:bg-slate-50"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-900">{row.title}</span>
                    {row.subtitle && <span className="block truncate text-xs text-slate-500">{row.subtitle}</span>}
                  </span>
                  {i === active && <kbd className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600">↵</kbd>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">↑↓ gezin · ↵ aç · Ctrl+K kapat/aç</div>
      </div>
    </div>
  );
}
