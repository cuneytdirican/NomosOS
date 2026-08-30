import { Container, Section, SectionHeading } from "./primitives";
import { faq } from "./content";

/**
 * 3.11 SSS — 10 soru.
 * details/summary kullanılır: JavaScript'siz çalışır ve klavyeyle gezilebilir.
 */
export function FaqSection() {
  return (
    <Section id="sss" tone="alt">
      <Container>
        <SectionHeading kicker={faq.kicker} title={faq.title} />

        <div className="mt-10 overflow-hidden rounded-[5px] border border-[var(--rule)] bg-white">
          {faq.items.map((item) => (
            <details key={item.q} className="group border-b border-[var(--rule)] last:border-b-0">
              <summary className="flex items-center justify-between gap-4 px-5 py-4 text-[0.95rem] font-medium text-[var(--ink)] hover:bg-[var(--paper)]">
                <span>{item.q}</span>
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--gold)] transition-transform group-open:rotate-45"
                >
                  <path
                    d="M8 3v10M3 8h10"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </summary>
              <p className="px-5 pb-5 pr-10 text-[0.95rem] text-[var(--ink-soft)]">{item.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </Section>
  );
}
