"use client";

/**
 * Müvekkil portalı bileşen seti — elle yazılmış Tailwind (shadcn yok).
 *
 * Tasarım kuralları (apps/web'in büro panelinden ayrılan yanları):
 *  - Daha büyük punto, daha geniş satır aralığı, daha az bilgi yoğunluğu.
 *  - Yumuşak kağıt zemin; keskin kırmızı/alarm renkleri yok. Portal bir izleme
 *    ekranıdır, bir uyarı paneli değil.
 *  - Boş durumlar suçlayıcı değil açıklayıcıdır: "veri yok" değil,
 *    "avukatınız henüz bu bölümde paylaşım yapmadı".
 *  - Her etkileşimli öğede görünür odak halkası (klavye ve ekran okuyucu).
 */

import { useEffect, type ReactNode } from "react";
import type { Tone } from "@/lib/labels";

// ---------------------------------------------------------------------------
// Düğme
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "quiet";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-paper hover:bg-ink-soft disabled:bg-ink-faint focus-visible:outline-ink",
  secondary:
    "border border-rule bg-white text-ink hover:bg-paper-alt disabled:text-ink-faint focus-visible:outline-gold",
  quiet:
    "text-ink-soft hover:bg-paper-alt disabled:text-ink-faint focus-visible:outline-gold",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
}) {
  const sizeCls =
    size === "sm"
      ? "px-3.5 py-2 text-sm"
      : size === "lg"
        ? "px-6 py-3.5 text-base"
        : "px-5 py-2.5 text-[15px]";
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${sizeCls} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Kart ve bölüm
// ---------------------------------------------------------------------------

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-rule bg-white shadow-paper ${className}`}
    >
      {(title !== undefined || action !== undefined) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule/70 px-6 py-4">
          <div className="min-w-0">
            {title !== undefined && (
              <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
            )}
            {subtitle !== undefined && (
              <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

/** Sayfa başlığı — serif, geniş nefes alanı, isteğe bağlı açıklama. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-ink sm:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-reading text-[15px] leading-relaxed text-ink-soft">
            {description}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Rozet
// ---------------------------------------------------------------------------

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-paper-alt text-ink-soft ring-rule",
  info: "bg-[#EDF1F8] text-[#2A3F63] ring-[#D3DCEB]",
  good: "bg-calm-greenSoft text-calm-green ring-[#C9E1D5]",
  warn: "bg-calm-amberSoft text-calm-amber ring-[#EBDBB4]",
  alert: "bg-calm-roseSoft text-calm-rose ring-[#EBCFCC]",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium ring-1 ring-inset ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form alanları
// ---------------------------------------------------------------------------

const FIELD_CLS =
  "w-full rounded-xl border border-rule bg-white px-4 py-3 text-base text-ink placeholder:text-ink-faint focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 disabled:bg-paper-alt";

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_CLS} ${className}`} {...props} />;
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
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium text-ink-soft"
      >
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-sm text-ink-faint">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Durum kutuları
// ---------------------------------------------------------------------------

export function Spinner({ label = "Bilgiler getiriliyor…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-[15px] text-ink-faint">
      <svg className="h-5 w-5 animate-spin text-gold" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

/**
 * Nazik boş durum. Varsayılan metin bilinçlidir: portalda hiçbir şeyin
 * görünmemesi bir arıza değil, YAYIN KARARIDIR.
 */
export function EmptyState({
  message = "Avukatınız henüz bu bölümde paylaşım yapmadı.",
  hint,
}: {
  message?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-rule bg-paper-alt/60 px-6 py-10 text-center">
      <p className="text-[15px] text-ink-soft">{message}</p>
      {hint && <p className="mt-2 text-sm text-ink-faint">{hint}</p>}
    </div>
  );
}

/** Hata kutusu — teknik ayrıntı yok, ne yapılacağı yazar. */
export function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#EBCFCC] bg-calm-roseSoft px-5 py-4">
      <p className="text-[15px] text-calm-rose">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-[#DFC2BE] bg-white px-4 py-2 text-sm font-medium text-calm-rose transition-colors hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          Yeniden dene
        </button>
      )}
    </div>
  );
}

export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#EBDBB4] bg-calm-amberSoft px-5 py-4 text-[15px] text-calm-amber">
      {children}
    </div>
  );
}

export function SuccessBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#C9E1D5] bg-calm-greenSoft px-5 py-4 text-[15px] text-calm-green">
      {children}
    </div>
  );
}

/**
 * Yükleniyor / uç yok / hata / boş durumlarını tek yerde toplayan sarmalayıcı.
 *
 * `missing` durumunda müvekkile teknik hata gösterilmez; beklenen uç adresi
 * yalnız `title` özniteliğinde (geliştirici için) durur.
 */
export function ResourceView({
  loading,
  missing,
  forbidden,
  error,
  empty,
  endpoint,
  emptyMessage,
  emptyHint,
  loadingLabel,
  onRetry,
  children,
}: {
  loading: boolean;
  missing?: boolean;
  forbidden?: boolean;
  error?: string | null;
  empty?: boolean;
  endpoint?: string;
  emptyMessage?: string;
  emptyHint?: string;
  loadingLabel?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) return <Spinner label={loadingLabel} />;

  if (missing) {
    return (
      <div
        title={endpoint ? `Beklenen uç: ${endpoint}` : undefined}
        className="rounded-xl border border-dashed border-rule bg-paper-alt/60 px-6 py-10 text-center"
      >
        <p className="text-[15px] text-ink-soft">
          Bu bölüm şu anda görüntülenemiyor.
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          Kısa bir süre sonra tekrar deneyin. Sorun sürerse avukatınıza haber verin.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg border border-rule bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Yeniden dene
          </button>
        )}
      </div>
    );
  }

  if (forbidden) {
    return (
      <EmptyState
        message="Bu bilgiye erişim yetkiniz bulunmuyor."
        hint="Portalda yalnızca avukatınızın sizinle paylaştığı bilgiler görünür."
      />
    );
  }

  if (error) return <ErrorBox message={error} onRetry={onRetry} />;

  if (empty) return <EmptyState message={emptyMessage} hint={emptyHint} />;

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Özet kartı (panel)
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  hint,
  href,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  emphasis?: boolean;
}) {
  const body = (
    <div
      className={`h-full rounded-2xl border px-6 py-5 shadow-paper transition-transform ${
        emphasis
          ? "border-gold-soft bg-gold-soft/40"
          : "border-rule bg-white"
      } ${href ? "hover:-translate-y-0.5" : ""}`}
    >
      <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-gold-deep">
        {label}
      </p>
      <p className="mt-3 font-serif text-[1.6rem] font-semibold leading-tight text-ink">
        {value}
      </p>
      {hint && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{hint}</p>}
    </div>
  );
  if (!href) return body;
  return (
    <a
      href={href}
      className="block rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      {body}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Küçük yardımcılar
// ---------------------------------------------------------------------------

/** Etiket + değer satırı. Değer yoksa satır HİÇ çizilmez (boş "—" yığını olmasın). */
export function DataRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule/60 py-3 last:border-b-0">
      <span className="text-sm font-medium text-ink-faint">{label}</span>
      <span className="text-[15px] text-ink">{children}</span>
    </div>
  );
}

/** Gizlilik notu — panelde ve liste sayfalarının altında durur. */
export function PrivacyNote({ className = "" }: { className?: string }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-xl bg-paper-alt/70 px-4 py-3 text-sm leading-relaxed text-ink-soft ${className}`}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep">
        <path
          fillRule="evenodd"
          d="M10 1.5 3.5 4.2v5.1c0 4 2.7 7.7 6.5 9.2 3.8-1.5 6.5-5.2 6.5-9.2V4.2L10 1.5Zm0 5a1 1 0 0 1 1 1v3.2a1 1 0 1 1-2 0V7.5a1 1 0 0 1 1-1Zm0 8.2a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z"
          clipRule="evenodd"
        />
      </svg>
      <span>Bu sayfada yalnızca avukatınızın sizinle paylaştığı bilgiler görünür.</span>
    </p>
  );
}

/** Açılır bölüm — ikinci düzey ayrıntı varsayılan olarak kapalı durur. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-rule bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[15px] font-medium text-ink-soft hover:bg-paper-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
        <span className="min-w-0">{summary}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-ink-faint transition-transform group-open:rotate-180"
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </summary>
      <div className="border-t border-rule/70 px-4 py-4 text-[15px] leading-relaxed text-ink-soft">
        {children}
      </div>
    </details>
  );
}

/** Basit kip — belge önizleme / onay diyalogları için. */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-rule px-6 py-4">
          <h3 className="font-serif text-lg font-semibold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-paper-alt hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
