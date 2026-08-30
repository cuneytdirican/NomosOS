"use client";

/**
 * Kaydedilmiş hesap izini okunabilir biçimde gösterir.
 *
 * `Deadline.computeNote` çok satırlı bir metindir (adımlar "\n" ile ayrılır).
 * Tek bir `<p>` içinde basıldığında HTML satır sonlarını boşluğa çevirdiği için
 * 5-6 adımlık hukuki gerekçe tek bir ezik satıra dönüşüyor ve fiilen
 * okunamıyordu — denetlenebilirlik iddiasının zayıf halkası buydu
 * (denetim bulgusu 11).
 *
 * Varsayılan olarak katlanmıştır; açıldığında `whitespace-pre-line` ile
 * satır yapısı korunur ve metin seçilip dilekçeye kopyalanabilir.
 */

import { useState } from "react";

export function ComputeNote({ note }: { note?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!note) return null;

  const lineCount = note.split("\n").filter((l) => l.trim().length > 0).length;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-slate-500 hover:text-amber-600"
      >
        <span aria-hidden="true" className={open ? "rotate-90 transition" : "transition"}>
          ▸
        </span>
        {open ? "Hesap izini gizle" : `Hesap izini göster (${lineCount} adım)`}
      </button>
      {open && (
        <pre className="mt-1 whitespace-pre-line rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-sans text-[11px] leading-5 text-slate-600">
          {note}
        </pre>
      )}
    </div>
  );
}
