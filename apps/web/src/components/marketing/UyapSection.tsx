import { Container, SampleDataBadge, Section, SectionHeading } from "./primitives";
import { uyap, uyapMockup } from "./content";

/** 3.8 UYAP köprüsü — eklenti ve senkronizasyon. */
export function UyapSection() {
  return (
    <Section id="uyap">
      <Container>
        <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <SectionHeading kicker={uyap.kicker} title={uyap.title} />
            <div className="mt-6 space-y-4 text-[1.0625rem] text-[var(--ink-soft)]">
              {uyap.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              <p>
                {uyap.signature.before}
                <strong className="font-semibold text-[var(--ink)]">{uyap.signature.strong}</strong>
                {uyap.signature.after}
              </p>
            </div>
            <p className="rule mt-8 pt-5 text-sm italic text-[var(--ink-soft)]">{uyap.note}</p>
          </div>

          {/* Eklenti akış mockup'ı — CSS ile çizilmiştir */}
          <figure className="m-0 overflow-hidden rounded-[6px] border border-[var(--rule)] bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] bg-[var(--paper-alt)] px-4 py-2.5">
              <span className="text-xs font-medium tracking-wide text-[var(--ink-soft)]">
                {uyapMockup.windowTitle}
              </span>
              <SampleDataBadge label={uyapMockup.sampleBadge} />
            </div>
            <ul className="divide-y divide-[var(--rule)] text-[12.5px]">
              {uyapMockup.rows.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="block font-medium text-[var(--ink)]">{row.label}</span>
                    <span className="block text-[11.5px] text-[var(--ink-soft)]">{row.detail}</span>
                  </span>
                  <span className="shrink-0 rounded-sm border border-[var(--rule)] bg-[var(--paper)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-soft)]">
                    {row.state}
                  </span>
                </li>
              ))}
            </ul>
          </figure>
        </div>
      </Container>
    </Section>
  );
}
