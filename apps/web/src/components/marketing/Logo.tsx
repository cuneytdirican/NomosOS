/**
 * NomosOS amblemi.
 *
 * Terazi motifi yalnızca amblemde ve soyut biçimde kullanılır (docs/08 §1.4):
 * bir dikey mil, bir yatay kefe kolu ve iki soyut kefe yayı. Tokmak (gavel) yoktur.
 */
export function Logo({
  onInk = false,
  className = "",
}: {
  onInk?: boolean;
  className?: string;
}) {
  const ink = onInk ? "var(--paper)" : "var(--ink)";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden="true" fill="none">
        <path d="M14 4v19" stroke={ink} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M4 8h20" stroke={ink} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M8 23h12" stroke={ink} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M1.5 8 5 15h7L8.5 8" stroke="var(--gold)" strokeWidth="1.2" strokeLinejoin="round" />
        <path
          d="M19.5 8 16 15h7l-3.5-7"
          stroke="var(--gold)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <circle cx="14" cy="8" r="1.6" fill="var(--gold)" />
      </svg>
      <span
        className="serif text-[1.3rem] font-semibold tracking-tight"
        style={{ color: onInk ? "var(--paper)" : "var(--ink)" }}
      >
        Nomos<span style={{ color: "var(--gold)" }}>OS</span>
      </span>
    </span>
  );
}
