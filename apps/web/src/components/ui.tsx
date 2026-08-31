"use client";

/** Sade, elle yazılmış Tailwind bileşen seti — NomosOS uygulama arayüzü. */

import { useEffect, useId, useState, type ReactNode } from "react";
import type { BadgeTone } from "@/lib/labels";

// ---------- Button ----------

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "gold";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400 focus-visible:outline-slate-900",
  gold:
    "bg-amber-500 text-slate-900 hover:bg-amber-400 disabled:bg-amber-200 focus-visible:outline-amber-500",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400 focus-visible:outline-slate-400",
  danger:
    "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300 focus-visible:outline-red-600",
  ghost:
    "text-slate-600 hover:bg-slate-100 disabled:text-slate-300 focus-visible:outline-slate-400",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  const sizeCls = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${sizeCls} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

// ---------- Card ----------

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title !== undefined || action !== undefined) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

// ---------- Badge ----------

const BADGE_TONES: Record<BadgeTone, string> = {
  gray: "bg-slate-100 text-slate-600 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  yellow: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  danger: "bg-red-700 text-white ring-red-700",
  navy: "bg-slate-900 text-white ring-slate-900",
  gold: "bg-amber-500 text-slate-900 ring-amber-500",
};

export function Badge({
  tone = "gray",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ---------- Form ----------

const FIELD_CLS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50";

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_CLS} ${className}`} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${FIELD_CLS} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD_CLS} ${className}`} {...props} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

// ---------- Modal ----------

export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 pt-16"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-xl bg-white shadow-2xl`}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ---------- Durum bileşenleri ----------

export function Spinner({ label = "Yükleniyor…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
      <svg className="h-4 w-4 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
      </svg>
      {label}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {message}
    </p>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </p>
  );
}

export function SuccessBox({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      {message}
    </p>
  );
}

// ---------- KPI kartı ----------

const STAT_TONES: Record<"navy" | "gold" | "red" | "green" | "slate", string> = {
  navy: "bg-slate-900 text-white",
  gold: "bg-amber-500 text-slate-900",
  red: "bg-red-700 text-white",
  green: "bg-emerald-600 text-white",
  slate: "bg-white text-slate-900 border border-slate-200",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "slate",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: keyof typeof STAT_TONES;
  href?: string;
}) {
  const muted = tone === "slate" ? "text-slate-500" : "opacity-75";
  const body = (
    <div
      className={`rounded-xl px-5 py-4 shadow-sm transition-transform ${STAT_TONES[tone]} ${
        href ? "hover:-translate-y-0.5 hover:shadow-md" : ""
      }`}
    >
      <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>{label}</p>
      <p className="mt-1.5 text-3xl font-bold leading-none">{value}</p>
      {hint && <p className={`mt-2 text-xs ${muted}`}>{hint}</p>}
    </div>
  );
  if (!href) return body;
  return (
    <a href={href} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500">
      {body}
    </a>
  );
}

// ---------- Sekmeler ----------

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel = "Sekmeler",
}: {
  tabs: ReadonlyArray<{ key: T; label: string; count?: number }>;
  active: T;
  onChange: (key: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="border-b border-slate-200">
      <nav className="-mb-px flex flex-wrap gap-1" aria-label={ariaLabel}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              active === t.key
                ? "border-amber-500 text-slate-900"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ---------- Küçük yardımcılar ----------

/** Etiket + değer satırı (detay kartlarında kullanılır). */
export function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="text-right text-sm text-slate-800">{children}</span>
    </div>
  );
}

// ---------- Faz 4 eklemeleri (yalnız EKLEME) ----------

/**
 * Açılır bölüm — "neden bu skor", "kaynak alıntıları" gibi ikinci düzey
 * gerekçelerin varsayılan olarak kapalı durmasını sağlar.
 *
 * `<details>` kullanılır: klavye ve ekran okuyucu desteği tarayıcıdan gelir,
 * JavaScript kapalıyken de açılır.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className = "",
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={`group rounded-lg border border-slate-200 bg-white ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
        <span className="min-w-0">{summary}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </summary>
      <div className="border-t border-slate-100 px-3 py-3">{children}</div>
    </details>
  );
}

// ---------- Faz 5 eklemeleri (yalnız EKLEME) ----------

/**
 * Açma/kapama anahtarı — portal yayın yönetiminin ana denetimi.
 *
 * `role="switch"` taşıyan gerçek bir düğmedir: klavyeyle erişilir, ekran
 * okuyucu "açık/kapalı" durumunu okur. Yayın kararı KVKK açısından sonuç
 * doğurduğu için `busy` sırasında tıklama kapatılır — çift tıklama yayını
 * açıp hemen kapatmasın.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  busy = false,
  tone = "gold",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Ekran okuyucu etiketi — görsel metin ayrı yazılır. */
  label: string;
  disabled?: boolean;
  busy?: boolean;
  tone?: "gold" | "green";
}) {
  const on = tone === "green" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? on : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[1.15rem]" : "translate-x-[0.15rem]"
        } ${busy ? "animate-pulse" : ""}`}
      />
    </button>
  );
}

/**
 * BİR KEZ gösterilen gizli değer (portal davet bağlantısı).
 *
 * Davet token'ının yalnızca SHA-256 özeti saklanır; ham bağlantı bir daha
 * üretilemez. Bu yüzden bileşen "bu değer bir daha gösterilmeyecek" uyarısını
 * kendisi taşır ve panoya kopyalamayı kolaylaştırır.
 */
export function CopyOnceField({
  value,
  label,
  warning = "Bu bağlantı bir daha gösterilmeyecek. Kopyalayıp müvekkile iletin.",
}: {
  value: string;
  label: string;
  warning?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      // Pano izni yoksa kullanıcı elle seçebilsin diye metin görünür durur.
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded border border-amber-200 bg-white px-2 py-1.5 text-xs text-slate-800">
          {value}
        </code>
        <Button size="sm" variant={copied ? "secondary" : "gold"} onClick={() => void copy()}>
          {copied ? "Kopyalandı" : "Kopyala"}
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-amber-800">{warning}</p>
    </div>
  );
}

// ---------- Faz 6 eklemeleri (yalnız EKLEME) ----------

/**
 * DÖNEM FARKI GÖSTERGESİ.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ OK YÖNÜ değerin gittiği yönü, RENK ise bunun iyi mi kötü mü olduğunu     ║
 * ║ söyler. İkisi AYRI bilgidir ve burada bilinçli olarak ayrıştırılmıştır.  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * "Kaçırılan süre 2 → 5" yükselen bir oktur ama KIRMIZIDIR. Rengi çağıran
 * belirler (`tone`), çünkü metriğin "iyi yönü" veriye aittir, bileşene değil.
 * `tone="notr"` iyi yön bilinmiyor demektir ve gri kalır — bilinmeyeni yeşile
 * boyamak, olmayan bir başarıyı raporlamaktır.
 *
 * Ekran okuyucu için ok işareti YETMEZ: `aria-label` farkı sözle yazar.
 */
export function DeltaIndicator({
  delta,
  tone,
  valueText,
  percentText,
  previousText,
  className = "",
}: {
  /** Farkın işareti (yön oku için). null → "önceki dönem verisi yok". */
  delta: number | null | undefined;
  tone: "iyi" | "kotu" | "notr";
  /** Biçimlenmiş mutlak fark, örn. "12.400,00 ₺" veya "3". */
  valueText: string;
  /** Biçimlenmiş yüzde, örn. "%12,4". Oran tanımsızsa boş bırakılır. */
  percentText?: string;
  /** Önceki dönem değeri — ipucu metninde gösterilir. */
  previousText?: string;
  className?: string;
}) {
  const TONES: Record<"iyi" | "kotu" | "notr", string> = {
    iyi: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    kotu: "bg-red-50 text-red-700 ring-red-200",
    notr: "bg-slate-100 text-slate-600 ring-slate-200",
  };

  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return (
      <span
        className={`inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-inset ring-slate-200 ${className}`}
        title="Önceki dönem verisi yok — karşılaştırma yapılamıyor."
      >
        karşılaştırma yok
      </span>
    );
  }

  const up = delta > 0;
  const flat = delta === 0;
  const arrow = flat ? "→" : up ? "↑" : "↓";
  const yon = flat ? "değişmedi" : up ? "arttı" : "azaldı";
  const yorum = tone === "iyi" ? "olumlu" : tone === "kotu" ? "olumsuz" : "yön nötr";

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${TONES[tone]} ${className}`}
      aria-label={`Önceki döneme göre ${yon}: ${valueText}${percentText ? ` (${percentText})` : ""} — ${yorum}`}
      title={
        previousText
          ? `Önceki dönem: ${previousText} · fark ${valueText}${percentText ? ` (${percentText})` : ""}`
          : `Önceki döneme göre fark: ${valueText}`
      }
    >
      <span aria-hidden="true">{arrow}</span>
      {valueText}
      {percentText && <span className="font-normal opacity-75">{percentText}</span>}
    </span>
  );
}

/** Tabloda sıralanabilir başlık — tıklanınca artan/azalan/kapalı döngüsü. */
export function SortHeader({
  label,
  active,
  descending,
  numeric = false,
  onClick,
}: {
  label: string;
  active: boolean;
  descending: boolean;
  numeric?: boolean;
  onClick: () => void;
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? (descending ? "descending" : "ascending") : "none"}
      className={`whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${
        numeric ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${numeric ? "flex-row-reverse" : ""}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={active ? "text-amber-600" : "text-slate-300"}>
          {active ? (descending ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

export interface ChartPoint {
  label: string;
  value: number;
  /** Önceki dönemin aynı noktası — hayalet karşılaştırma için. */
  previous?: number | null;
}

/**
 * YATAY ÇUBUK LİSTESİ — kategori büyüklüklerini karşılaştırmak için.
 *
 * Harici grafik kütüphanesi KURULMAZ (ürün kararı): çubuklar saf CSS'tir,
 * bu yüzden yazdırmada da, JavaScript kapalıyken de aynı görünür.
 *
 * ÇUBUK RENGİ NÖTRDÜR. Yeşil/kırmızı yalnızca fark rozetine ayrılmıştır;
 * çubuğu da boyamak, tek bir bilgiyi iki kez ve çelişkili biçimde söylemek
 * olurdu ("büyük çubuk = kötü mü iyi mi?"). Büyüklüğü uzunluk anlatır.
 */
export function BarList({
  points,
  format,
  emptyMessage = "Gösterilecek veri yok.",
  max,
}: {
  points: ChartPoint[];
  format: (value: number) => string;
  emptyMessage?: string;
  /** Ölçek tavanı; verilmezse en büyük değerden türetilir. */
  max?: number;
}) {
  if (points.length === 0) return <EmptyState message={emptyMessage} />;

  const values = points.flatMap((p) => [p.value, ...(p.previous != null ? [p.previous] : [])]);
  const top = max ?? Math.max(...values, 0);
  const scale = (v: number) => (top <= 0 ? 0 : Math.max(0, Math.min(100, (v / top) * 100)));
  const hasPrevious = points.some((p) => p.previous != null);

  return (
    <div>
      <ul className="space-y-2">
        {points.map((p, i) => (
          <li key={`${p.label}-${i}`} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-slate-600" title={p.label}>
              {p.label}
            </span>
            <span className="relative block h-2 rounded-full bg-slate-100">
              <span
                className="block h-2 rounded-full bg-slate-800"
                style={{ width: `${scale(p.value)}%` }}
              />
              {p.previous != null && (
                // Önceki dönem: 2px'lik nötr işaret. Ayrı bir çubuk değil, ölçüt.
                <span
                  aria-hidden="true"
                  title={`Önceki dönem: ${format(p.previous)}`}
                  className="absolute top-[-2px] h-3 w-0.5 rounded-full bg-slate-400"
                  style={{ left: `calc(${scale(p.previous)}% - 1px)` }}
                />
              )}
            </span>
            <span className="text-right text-xs font-semibold tabular-nums text-slate-900">
              {format(p.value)}
            </span>
          </li>
        ))}
      </ul>
      {hasPrevious && (
        <p className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
          <span aria-hidden="true" className="inline-block h-3 w-0.5 rounded-full bg-slate-400" />
          önceki dönem değeri
        </p>
      )}
    </div>
  );
}

/**
 * ÇİZGİ GRAFİĞİ — zaman içindeki değişim için (inline SVG, kütüphanesiz).
 *
 * TEK EKSEN: önceki dönem serisi AYNI ölçekte kesikli çizgiyle çizilir. İki
 * ayrı y ekseni kullanmak, iki farklı büyüklüğü aynı eğimle göstererek
 * sahte bir ilişki uydurmaktır — bu grafikte bilinçli olarak yoktur.
 *
 * Her noktanın `<title>` etiketi vardır: fare üzerine gelince tarayıcının
 * kendi ipucu çıkar, ekran okuyucu da okur. Değer etiketi YALNIZCA ilk ve son
 * noktada basılır; her noktaya sayı yazmak çizgiyi okunmaz hâle getirir.
 */
export function LineChart({
  points,
  format,
  label,
  previousLabel = "Önceki dönem",
  emptyMessage = "Gösterilecek veri yok.",
}: {
  points: ChartPoint[];
  format: (value: number) => string;
  label: string;
  previousLabel?: string;
  emptyMessage?: string;
}) {
  const clipId = useId();
  if (points.length < 2) return <EmptyState message={emptyMessage} />;

  const W = 640;
  const H = 180;
  const PAD_X = 8;
  const PAD_Y = 16;

  const all = points.flatMap((p) => [p.value, ...(p.previous != null ? [p.previous] : [])]);
  const rawMax = Math.max(...all);
  const rawMin = Math.min(...all, 0);
  const span = rawMax - rawMin || 1;
  const x = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / (points.length - 1);
  const y = (v: number) => H - PAD_Y - ((v - rawMin) / span) * (H - PAD_Y * 2);

  const path = (get: (p: ChartPoint) => number | null | undefined) => {
    const parts: string[] = [];
    points.forEach((p, i) => {
      const v = get(p);
      if (v === null || v === undefined || !Number.isFinite(v)) return;
      parts.push(`${parts.length === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    return parts.join(" ");
  };

  const hasPrevious = points.some((p) => p.previous != null);
  const area = `${path((p) => p.value)} L${x(points.length - 1).toFixed(1)},${(H - PAD_Y).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD_Y).toFixed(1)} Z`;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-44 w-full"
        role="img"
        aria-label={`${label} — ${points.length} dönemlik seyir. En yüksek ${format(rawMax)}, en düşük ${format(rawMin)}.`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={W} height={H} />
          </clipPath>
        </defs>
        {/* Izgara geri planda kalır: veriyi değil, okumayı destekler. */}
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={PAD_Y + t * (H - PAD_Y * 2)}
            y2={PAD_Y + t * (H - PAD_Y * 2)}
            className="stroke-slate-200"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <g clipPath={`url(#${clipId})`}>
          <path d={area} className="fill-slate-900/5" />
          {hasPrevious && (
            <path
              d={path((p) => p.previous)}
              className="stroke-slate-300"
              strokeWidth="2"
              strokeDasharray="5 4"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={path((p) => p.value)}
            className="stroke-slate-800"
            strokeWidth="2"
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => (
            <circle key={`${p.label}-${i}`} cx={x(i)} cy={y(p.value)} r="4" className="fill-slate-800">
              <title>
                {p.label}: {format(p.value)}
                {p.previous != null ? ` · ${previousLabel}: ${format(p.previous)}` : ""}
              </title>
            </circle>
          ))}
        </g>
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>{points[0].label}</span>
        <span className="font-medium text-slate-600 tabular-nums">
          {format(points[points.length - 1].value)}
        </span>
        <span>{points[points.length - 1].label}</span>
      </div>
      {hasPrevious && (
        <figcaption className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-5 rounded bg-slate-800" />
            {label}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-5 rounded bg-slate-300"
              style={{ backgroundImage: "repeating-linear-gradient(90deg,currentColor 0 4px,transparent 4px 8px)" }}
            />
            {previousLabel}
          </span>
        </figcaption>
      )}
    </figure>
  );
}
