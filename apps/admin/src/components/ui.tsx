"use client";

/**
 * Platform paneli bileşen seti — elle yazılmış Tailwind, harici UI kütüphanesi yok.
 * Tema: koyu çelik gri zemin + mor-indigo vurgu (tenant uygulamasından bilinçli olarak farklı).
 */

import { useEffect, type ReactNode } from "react";
import type { BadgeTone } from "@/lib/labels";

// ---------- Button ----------

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "warning";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-600 text-white hover:bg-accent-500 disabled:bg-accent-900 disabled:text-steel-400 focus-visible:outline-accent-400",
  secondary:
    "border border-steel-700 bg-steel-800 text-steel-100 hover:bg-steel-700 disabled:text-steel-500 focus-visible:outline-steel-500",
  danger:
    "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-900 disabled:text-red-300 focus-visible:outline-red-500",
  warning:
    "bg-amber-500 text-steel-950 hover:bg-amber-400 disabled:bg-amber-900 disabled:text-amber-300 focus-visible:outline-amber-400",
  ghost:
    "text-steel-300 hover:bg-steel-800 hover:text-steel-100 disabled:text-steel-600 focus-visible:outline-steel-500",
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
  const sizeCls = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm";
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
  subtitle,
  action,
  children,
  className = "",
  bodyClassName = "p-5",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-steel-800 bg-steel-900 shadow-lg shadow-black/20 ${className}`}
    >
      {(title !== undefined || action !== undefined) && (
        <header className="flex items-start justify-between gap-3 border-b border-steel-800 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-steel-50">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-steel-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

// ---------- Badge ----------

const BADGE_TONES: Record<BadgeTone, string> = {
  gray: "bg-steel-800 text-steel-300 ring-steel-700",
  steel: "bg-steel-700/50 text-steel-200 ring-steel-600",
  accent: "bg-accent-950 text-accent-300 ring-accent-700",
  blue: "bg-sky-950 text-sky-300 ring-sky-800",
  green: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  yellow: "bg-amber-950 text-amber-300 ring-amber-800",
  red: "bg-red-950 text-red-300 ring-red-800",
  danger: "bg-red-600 text-white ring-red-500",
};

export function Badge({
  tone = "gray",
  children,
  className = "",
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ---------- Form ----------

const FIELD_CLS =
  "w-full rounded-md border border-steel-700 bg-steel-950 px-3 py-2 text-sm text-steel-100 placeholder:text-steel-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 disabled:bg-steel-800 disabled:text-steel-500";

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
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-steel-300">
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-steel-500">{hint}</span>}
    </label>
  );
}

// ---------- Modal ----------

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-16 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl border border-steel-700 bg-steel-900 shadow-2xl`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-steel-800 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-steel-50">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-steel-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded-md p-1 text-steel-400 hover:bg-steel-800 hover:text-steel-100"
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

// ---------- Tablo ----------

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  empty = "Kayıt bulunamadı.",
  onRowClick,
  rowClassName,
  dense = false,
}: {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  empty?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  dense?: boolean;
}) {
  if (rows.length === 0) return <EmptyState message={empty} />;
  const pad = dense ? "px-3 py-2" : "px-4 py-3";
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-steel-800 text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`${pad} text-[11px] font-semibold uppercase tracking-wide text-steel-400 ${
                  c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""
                } ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-steel-800/60 transition-colors last:border-0 hover:bg-steel-800/40 ${
                onRowClick ? "cursor-pointer" : ""
              } ${rowClassName ? rowClassName(row) : ""}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${pad} align-middle text-steel-200 ${
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""
                  } ${c.className ?? ""}`}
                >
                  {c.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Durum bileşenleri ----------

export function Spinner({ label = "Yükleniyor…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-steel-400">
      <svg className="h-4 w-4 animate-spin text-accent-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
      </svg>
      {label}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-steel-700 bg-steel-950/60 px-4 py-6 text-center text-sm text-steel-400">
      {message}
    </p>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-200">
      {message}
    </p>
  );
}

export function SuccessBox({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-emerald-800 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
      {message}
    </p>
  );
}

export function InfoBox({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-sky-900 bg-sky-950/50 px-4 py-3 text-sm text-sky-200">
      {title && <p className="mb-1 font-semibold text-sky-100">{title}</p>}
      {children}
    </div>
  );
}

export function WarningBox({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-800 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
      {title && <p className="mb-1 font-semibold text-amber-100">{title}</p>}
      {children}
    </div>
  );
}

/**
 * "Bu uç henüz hazır değil" bilgilendirmesi.
 *
 * Uç 404/501/ağ hatası verdiğinde gösterilir. TEMSİLİ VERİ GÖSTERİLMEZ —
 * uydurma sayı ile gerçek veri asla karıştırılmaz.
 */
export function EndpointMissingNotice({
  endpoint,
  method = "GET",
  what,
}: {
  endpoint: string;
  method?: string;
  /** "AI kullanım kırılımı" gibi kısa bir ad. */
  what?: string;
}) {
  return (
    <div className="rounded-lg border border-accent-800 bg-accent-950/40 px-4 py-3 text-sm text-accent-200">
      <p className="font-semibold text-accent-100">Bu uç henüz hazır değil</p>
      <p className="mt-1 text-accent-200/90">
        {what ? `${what} için beklenen uç` : "Beklenen uç"}{" "}
        <code className="rounded bg-steel-950 px-1.5 py-0.5 font-mono text-xs text-steel-200">
          {method} /api/admin/v1{endpoint}
        </code>{" "}
        yanıt vermiyor (uç yazılmamış ya da servis kapalı). Panel{" "}
        <strong className="text-accent-100">temsili veri göstermez</strong>; uç yayına
        alındığında bu alan kendiliğinden dolar.
      </p>
    </div>
  );
}

/**
 * Kaynak durumu sarmalayıcısı — yükleniyor / uç yok / yetkisiz / hata / boş
 * durumlarını tek yerden, tutarlı biçimde gösterir.
 */
export function ResourceView({
  loading,
  missing,
  forbidden,
  error,
  empty,
  endpoint,
  method = "GET",
  what,
  emptyMessage = "Kayıt bulunamadı.",
  loadingLabel,
  children,
}: {
  loading: boolean;
  missing?: boolean;
  forbidden?: boolean;
  error?: string | null;
  empty?: boolean;
  endpoint: string;
  method?: string;
  what?: string;
  emptyMessage?: string;
  loadingLabel?: string;
  children: ReactNode;
}) {
  if (loading) return <Spinner label={loadingLabel} />;
  if (missing) return <EndpointMissingNotice endpoint={endpoint} method={method} what={what} />;
  if (forbidden)
    return (
      <ErrorBox message="Bu veriyi görüntüleme yetkiniz yok. Sunucu 403 döndürdü (yetki matrisi API katmanında zorlanır)." />
    );
  if (error) return <ErrorBox message={error} />;
  if (empty) return <EmptyState message={emptyMessage} />;
  return <>{children}</>;
}

// ---------- Sayfa başlığı ----------

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-steel-50">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-steel-400">{description}</p>}
      </div>
      {action}
    </header>
  );
}

// ---------- KPI kartı ----------

const STAT_TONES: Record<"steel" | "accent" | "green" | "red" | "yellow", string> = {
  steel: "border-steel-800 bg-steel-900",
  accent: "border-accent-800 bg-accent-950/50",
  green: "border-emerald-900 bg-emerald-950/40",
  red: "border-red-900 bg-red-950/40",
  yellow: "border-amber-900 bg-amber-950/40",
};

export function StatCard({
  label,
  value,
  hint,
  trend,
  tone = "steel",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /** Örn. "+14 bu ay" — pozitifse yeşil, "-" ile başlıyorsa kırmızı. */
  trend?: string;
  tone?: keyof typeof STAT_TONES;
  href?: string;
}) {
  const trendCls = trend?.trim().startsWith("-") ? "text-red-400" : "text-emerald-400";
  const body = (
    <div
      className={`h-full rounded-xl border px-5 py-4 shadow-lg shadow-black/20 transition-transform ${STAT_TONES[tone]} ${
        href ? "hover:-translate-y-0.5 hover:border-accent-600" : ""
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-steel-400">{label}</p>
      <p className="mt-1.5 text-2xl font-bold leading-none text-steel-50">{value}</p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {trend && <span className={trendCls}>{trend}</span>}
        {hint && <span className="text-steel-500">{hint}</span>}
      </div>
    </div>
  );
  if (!href) return body;
  return (
    <a
      href={href}
      className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400"
    >
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
  tabs: ReadonlyArray<{ key: T; label: string; count?: number; disabled?: boolean }>;
  active: T;
  onChange: (key: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="border-b border-steel-800">
      <nav className="-mb-px flex flex-wrap gap-1" aria-label={ariaLabel}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={t.disabled}
            onClick={() => onChange(t.key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-steel-600 ${
              active === t.key
                ? "border-accent-500 text-steel-50"
                : "border-transparent text-steel-400 hover:border-steel-600 hover:text-steel-200"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className="ml-2 rounded-full bg-steel-800 px-1.5 py-0.5 text-[11px] font-semibold text-steel-300">
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

export function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-steel-800/60 py-2 last:border-0">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-steel-500">
        {label}
      </span>
      <span className="text-right text-sm text-steel-100">{children}</span>
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-steel-100">{children}</h3>
      {hint && <p className="mt-0.5 text-xs text-steel-500">{hint}</p>}
    </div>
  );
}

// ---------- Basit görselleştirme (harici kütüphane yok — saf CSS/SVG) ----------

export interface BarItem {
  label: string;
  value: number;
  /** Sağdaki ikincil metin (ör. "%41" veya "1,2 M token") */
  hint?: string;
  tone?: "accent" | "green" | "yellow" | "red" | "steel";
}

const BAR_TONES: Record<NonNullable<BarItem["tone"]>, string> = {
  accent: "bg-accent-500",
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  steel: "bg-steel-500",
};

/** Yatay çubuk listesi — CSS genişlikleriyle çizilir. */
export function BarList({ items, max }: { items: readonly BarItem[]; max?: number }) {
  if (items.length === 0) return <EmptyState message="Gösterilecek veri yok." />;
  const peak = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-steel-300">{item.label}</span>
            <span className="shrink-0 font-mono text-steel-400">{item.hint}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-steel-800">
            <div
              className={`h-full rounded-full ${BAR_TONES[item.tone ?? "accent"]}`}
              style={{ width: `${Math.max(1, Math.round((item.value / peak) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** SVG sütun grafiği — zaman serisi (ör. 30 günlük token tüketimi). */
export function ColumnChart({
  points,
  height = 120,
  ariaLabel,
}: {
  points: ReadonlyArray<{ label: string; value: number }>;
  height?: number;
  ariaLabel: string;
}) {
  if (points.length === 0) return <EmptyState message="Gösterilecek veri yok." />;
  const peak = Math.max(...points.map((p) => p.value), 1);
  const width = 100;
  const gap = 0.6;
  const bw = width / points.length - gap;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        className="h-32 w-full"
      >
        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1="0"
            x2={width}
            y1={height * r}
            y2={height * r}
            stroke="currentColor"
            strokeWidth="0.3"
            className="text-steel-800"
          />
        ))}
        {points.map((p, i) => {
          const h = Math.max(1, (p.value / peak) * (height - 6));
          return (
            <rect
              key={`${p.label}-${i}`}
              x={i * (bw + gap)}
              y={height - h}
              width={bw}
              height={h}
              rx="0.6"
              className="fill-accent-500"
            >
              <title>{`${p.label}: ${p.value.toLocaleString("tr-TR")}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-steel-500">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}

/** SVG çizgi grafiği — zaman serisi (ör. günlük token tüketimi). */
export function LineChart({
  points,
  height = 120,
  ariaLabel,
  valueFormatter,
}: {
  points: ReadonlyArray<{ label: string; value: number }>;
  height?: number;
  ariaLabel: string;
  valueFormatter?: (v: number) => string;
}) {
  if (points.length === 0) return <EmptyState message="Gösterilecek veri yok." />;
  const peak = Math.max(...points.map((p) => p.value), 1);
  const width = 100;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const y = (v: number) => height - Math.max(1, (v / peak) * (height - 6));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${i * step},${y(p.value)}`).join(" ");
  const area = `${path} L${(points.length - 1) * step},${height} L0,${height} Z`;
  const fmt = valueFormatter ?? ((v: number) => v.toLocaleString("tr-TR"));

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        className="h-32 w-full"
      >
        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1="0"
            x2={width}
            y1={height * r}
            y2={height * r}
            stroke="currentColor"
            strokeWidth="0.3"
            className="text-steel-800"
          />
        ))}
        <path d={area} className="fill-accent-500/15" />
        <path
          d={path}
          fill="none"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          className="stroke-accent-400"
        />
        {points.map((p, i) => (
          <circle key={`${p.label}-${i}`} cx={i * step} cy={y(p.value)} r="1.2" className="fill-accent-300">
            <title>{`${p.label}: ${fmt(p.value)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-steel-500">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}

/** Tek satırlık oran şeridi (ör. sağlayıcı dağılımı). */
export function StackedBar({
  segments,
}: {
  segments: ReadonlyArray<{ label: string; value: number; tone?: NonNullable<BarItem["tone"]> }>;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-steel-800">
        {segments.map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${Math.round((s.value / total) * 100)}%`}
            className={BAR_TONES[s.tone ?? "accent"]}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-steel-400">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${BAR_TONES[s.tone ?? "accent"]}`} />
            {s.label} · {Math.round((s.value / total) * 100)}%
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Sağlık rozeti ----------

export function HealthDot({ status }: { status: string }) {
  const cls =
    status === "OK"
      ? "bg-emerald-400"
      : status === "DEGRADED"
        ? "bg-amber-400"
        : status === "DOWN"
          ? "bg-red-500"
          : "bg-steel-500";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} />;
}
