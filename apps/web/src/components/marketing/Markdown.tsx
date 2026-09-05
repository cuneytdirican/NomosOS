import type { ReactNode } from "react";

/**
 * Sınırlı Markdown → JSX (Faz 8A blog). Desteklenen: `## başlık`, paragraf, `- madde`,
 * `**kalın**`, `[metin](url)`. Ham HTML YOK — içerik koddan gelir ama yine de enjekte edilmez.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${keyPrefix}-b${i}`}>{m[1]}</strong>);
    else if (m[2] !== undefined && m[3] !== undefined) {
      const href = m[3];
      const safe = href.startsWith("/") || href.startsWith("https://") || href.startsWith("http://") || href.startsWith("mailto:");
      out.push(
        safe ? (
          <a key={`${keyPrefix}-a${i}`} href={href} className="underline decoration-[#7a6220] underline-offset-2 hover:text-[#7a6220]">
            {m[2]}
          </a>
        ) : (
          m[2]
        ),
      );
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="space-y-5">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
        if (lines.length === 0) return null;
        if (lines.length === 1 && lines[0].startsWith("## ")) {
          return (
            <h2 key={bi} className="!mt-8 !text-[1.25rem]">
              {inline(lines[0].slice(3), `h${bi}`)}
            </h2>
          );
        }
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={bi} className="space-y-2">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-3 text-[1rem] text-[var(--ink-soft)]">
                  <span aria-hidden="true" className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-[#7a6220]" />
                  <span>{inline(l.slice(2), `l${bi}-${li}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="text-[1.0625rem] leading-relaxed text-[var(--ink-soft)]">
            {inline(lines.join(" "), `p${bi}`)}
          </p>
        );
      })}
    </div>
  );
}
