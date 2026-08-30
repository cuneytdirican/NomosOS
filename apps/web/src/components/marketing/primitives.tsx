import type { ReactNode } from "react";

/**
 * Pazarlama sitesinin ortak yapı taşları.
 * Tasarım dili: hukuk bürosu antetli kağıdı — ince çizgi, düz yüzey, küçük köşe yarıçapı.
 */

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Section({
  id,
  children,
  tone = "paper",
  className = "",
}: {
  id?: string;
  children: ReactNode;
  /** paper: ana zemin · alt: şerit bölüm zemini · ink: koyu bölüm */
  tone?: "paper" | "alt" | "ink";
  className?: string;
}) {
  const toneClass =
    tone === "alt"
      ? "bg-[var(--paper-alt)]"
      : tone === "ink"
        ? "bg-[var(--ink)]"
        : "bg-[var(--paper)]";
  return (
    <section
      id={id}
      className={`scroll-mt-24 py-20 sm:py-24 ${toneClass} ${className}`}
    >
      {children}
    </section>
  );
}

/** Küçük harf aralığı açılmış altın üst etiket + serif başlık. */
export function SectionHeading({
  kicker,
  title,
  lead,
  align = "left",
  onInk = false,
  headingId,
}: {
  kicker?: string;
  title: string;
  lead?: string;
  align?: "left" | "center";
  onInk?: boolean;
  headingId?: string;
}) {
  const alignClass = align === "center" ? "text-center mx-auto max-w-3xl" : "max-w-3xl";
  return (
    <div className={alignClass}>
      {kicker && (
        <p className={`kicker mb-3 ${onInk ? "!text-[var(--gold)]" : ""}`}>{kicker}</p>
      )}
      <h2
        id={headingId}
        className={`text-[1.75rem] sm:text-[2.15rem] ${onInk ? "!text-[var(--paper)]" : ""}`}
      >
        {title}
      </h2>
      {lead && (
        <p
          className={`mt-5 text-[1.0625rem] ${
            onInk ? "text-[#CFD6E4]" : "text-[var(--ink-soft)]"
          }`}
        >
          {lead}
        </p>
      )}
    </div>
  );
}

/** Bölümler arası ince altın ayraç. */
export function GoldRule() {
  return (
    <Container>
      <div className="gold-rule" aria-hidden="true" />
    </Container>
  );
}

/**
 * Mockup'ların üzerinde zorunlu olan "örnek veri" ibaresi.
 * Ekran görüntüsü yerine CSS/SVG çizim kullanıldığı için gerçek veri izlenimi verilmez.
 */
export function SampleDataBadge({ label = "örnek veri" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--rule)] bg-[var(--paper-alt)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ink-soft)]">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
      {label}
    </span>
  );
}

/** Birincil (altın) düğme. */
export function PrimaryButton({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={`inline-flex items-center justify-center rounded-[4px] bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--paper)] shadow-[0_1px_0_rgba(15,27,51,0.12)] transition-colors hover:bg-[#16264a] ${className}`}
    >
      {children}
    </a>
  );
}

/** İkincil (çerçeveli) düğme. */
export function SecondaryButton({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={`inline-flex items-center justify-center rounded-[4px] border border-[var(--ink)]/25 px-6 py-3 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--gold)] hover:text-[#7a6220] ${className}`}
    >
      {children}
    </a>
  );
}

/** İnce çizgili kart yüzeyi. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-[5px] border border-[var(--rule)] bg-white p-6 ${className}`}>
      {children}
    </div>
  );
}
