"use client";

/** Sade, elle yazılmış Tailwind bileşen seti — NomosOS uygulama arayüzü. */

import { useEffect, type ReactNode } from "react";
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
