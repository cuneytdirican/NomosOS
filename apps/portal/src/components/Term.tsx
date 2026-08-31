"use client";

/**
 * HUKUKİ JARGON AÇIKLAYICISI.
 *
 * Ürün kararı: müvekkil ekranında geçen her hukuk terimi, tek dokunuşla
 * açıklanabilir olmalıdır. İki kullanım biçimi vardır:
 *
 *   <Term>tensip zaptı</Term>              → tek terim, açıklama baloncuğu
 *   <TermText text={ozet} />               → serbest metin; sözlükteki terimler
 *                                            otomatik olarak işaretlenir
 *
 * Erişilebilirlik: baloncuk bir `<button>` üzerinden açılır (klavyeyle odaklanır,
 * dokunmatikte tıklanır), açıklama `aria-describedby` ile bağlanır. Yalnızca
 * `:hover` ile çalışan bir çözüm telefonda kullanılamazdı.
 *
 * Açıklama metinleri `lib/labels.ts` içindeki `GLOSSARY` sözlüğünden gelir —
 * AI üretimi DEĞİLDİR, elle yazılmış sabit metinlerdir. Bir hukuk teriminin
 * müvekkile ne anlatacağı, model çıktısına bırakılamayacak kadar kritiktir.
 */

import { useId, type ReactNode } from "react";
import { GLOSSARY, lookupTerm } from "@/lib/labels";

// ---------------------------------------------------------------------------
// Tek terim
// ---------------------------------------------------------------------------

export function Term({
  children,
  explain,
  term,
  interactive = true,
}: {
  /** Ekranda görünen metin. */
  children: ReactNode;
  /** Açıklamayı doğrudan vermek için (sözlükte olmayan terimler). */
  explain?: string;
  /** Sözlükte aranacak anahtar — verilmezse `children` metni kullanılır. */
  term?: string;
  /**
   * `false` → baloncuk hiç kurulmaz, metin düz çizilir.
   *
   * Bir bağlantının (`<a>`) İÇİNDE kullanıldığında zorunludur: iç içe
   * etkileşimli öğe geçersiz HTML üretir ve terime dokunan kullanıcı istemeden
   * sayfa değiştirir. Kart tıklanabilir olduğunda açıklama, kartın açtığı
   * detay sayfasında verilir.
   */
  interactive?: boolean;
}) {
  const id = useId();
  const key = term ?? (typeof children === "string" ? children : "");
  const text = explain ?? lookupTerm(key);

  // Açıklaması olmayan terim sessizce düz metin olarak çizilir.
  if (!text || !interactive) return <>{children}</>;

  return (
    <span className="group relative inline-block">
      <button
        type="button"
        aria-describedby={id}
        className="cursor-help border-b border-dotted border-gold text-inherit decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        {children}
        <span aria-hidden="true" className="ml-0.5 align-super text-[0.65em] text-gold-deep">
          ?
        </span>
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-30 mb-2 w-[min(20rem,78vw)] rounded-xl border border-rule bg-white px-4 py-3 text-left text-sm font-normal leading-relaxed text-ink-soft opacity-0 shadow-paper transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <span className="mb-1 block font-medium text-ink">
          {typeof children === "string" ? children : key}
        </span>
        {text}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Serbest metin taraması
// ---------------------------------------------------------------------------

/** Türkçe duyarlı küçük harfe indirme. Uzunluk korunmazsa tarama yapılmaz. */
function trLower(value: string): string {
  try {
    return value.toLocaleLowerCase("tr-TR");
  } catch {
    return value.toLowerCase();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sözlük terimleri, UZUNDAN KISAYA sıralanır: "bilirkişi raporu" ifadesi
 * "bilirkişi" tarafından parçalanmasın diye.
 */
const TERM_PATTERN = (() => {
  const keys = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return null;
  const body = keys.map(escapeRegExp).join("|");
  // Sözcük sınırı: Türkçe harfler `\b` ile güvenilir çalışmadığı için
  // "harf olmayan / dize başı-sonu" koşulu elle kurulur.
  //
  // Geriye bakış (lookbehind) eski tarayıcılarda SyntaxError atar. Bu, modül
  // yüklenirken tüm portalı çökertirdi; bu yüzden kurulum korumalıdır ve
  // desteklenmeyen tarayıcıda terim işaretlemesi sessizce devre dışı kalır.
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])(${body})(?![\\p{L}\\p{N}])`, "gu");
  } catch {
    return null;
  }
})();

interface Piece {
  text: string;
  term: string | null;
}

/** Metni, sözlük terimleri işaretlenmiş parçalara böler. */
export function splitByTerms(value: string): Piece[] {
  if (!TERM_PATTERN || !value) return [{ text: value, term: null }];

  const lower = trLower(value);
  // Küçük harfe indirme uzunluğu değiştirdiyse (nadir Unicode durumları)
  // konum eşlemesi bozulur; taramayı tümüyle atlarız.
  if (lower.length !== value.length) return [{ text: value, term: null }];

  const pieces: Piece[] = [];
  let cursor = 0;
  TERM_PATTERN.lastIndex = 0;

  for (let m = TERM_PATTERN.exec(lower); m !== null; m = TERM_PATTERN.exec(lower)) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > cursor) pieces.push({ text: value.slice(cursor, start), term: null });
    // Ekranda ÖZGÜN yazım korunur; sözlük anahtarı ayrıca taşınır.
    pieces.push({ text: value.slice(start, end), term: m[0] });
    cursor = end;
  }

  if (cursor < value.length) pieces.push({ text: value.slice(cursor), term: null });
  return pieces.length > 0 ? pieces : [{ text: value, term: null }];
}

/**
 * Serbest metni, içindeki hukuk terimleri açıklanabilir olacak biçimde çizer.
 * Avukatın yayınladığı durum özetlerinde ve safahat notlarında kullanılır.
 */
export function TermText({
  text,
  className = "",
  interactive = true,
}: {
  text: string | null | undefined;
  className?: string;
  /** Bağlantı içinde kullanılırken `false` verilmelidir (bkz. `Term`). */
  interactive?: boolean;
}) {
  if (!text) return null;
  if (!interactive) return <span className={className}>{text}</span>;
  const pieces = splitByTerms(text);
  return (
    <span className={className}>
      {pieces.map((p, i) =>
        p.term ? (
          <Term key={i} term={p.term}>
            {p.text}
          </Term>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}
