import { Container, SampleDataBadge, Section, SectionHeading } from "./primitives";
import { deadline } from "./content";
import { deadlineTrace } from "./deadline-trace";

/**
 * 3.4 Öne çıkan: süre motoru.
 *
 * Yanındaki hesap izi kartı GERÇEK motor çıktısıdır: `@nomosos/legal-core`
 * `computeDeadline` derleme anında çağrılır ve her satır motorun kendi
 * açıklamasıdır (bkz. deadline-trace.ts). Elle yazılan iz motordan sapmıştı.
 */
export function DeadlineFeature() {
  return (
    <Section id="sureler" tone="alt">
      <Container>
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading kicker={deadline.kicker} title={deadline.title} />
            <div className="mt-6 space-y-4 text-[1.0625rem] text-[var(--ink-soft)]">
              {deadline.paragraphs.map((paragraph) => {
                const parts = paragraph.split(deadline.emphasis);
                return (
                  <p key={paragraph}>
                    {parts.length === 2 ? (
                      <>
                        {parts[0]}
                        <strong className="font-semibold text-[var(--ink)]">
                          {deadline.emphasis}
                        </strong>
                        {parts[1]}
                      </>
                    ) : (
                      paragraph
                    )}
                  </p>
                );
              })}
            </div>
            <p className="rule mt-8 pt-5 text-sm text-[var(--ink-soft)]">{deadline.footnote}</p>
          </div>

          {/* Hesap izi kartı */}
          <figure className="m-0 overflow-hidden rounded-[6px] border border-[var(--rule)] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rule)] bg-[var(--paper)] px-4 py-3">
              <span className="tnum text-[12.5px] font-medium text-[var(--ink)]">
                {deadlineTrace.header}
              </span>
              <SampleDataBadge label={deadline.trace.sampleBadge} />
            </div>

            <ol className="tnum divide-y divide-[var(--rule)]">
              {deadlineTrace.steps.map((step) => (
                <li key={step.no} className="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-3">
                  <span className="w-4 shrink-0 text-[12.5px] font-semibold text-[#7a6220]">
                    {step.no}
                  </span>
                  <span className="w-[calc(100%-1.75rem)] shrink-0 text-[12.5px] text-[var(--ink-soft)] sm:w-[9.5rem]">
                    {step.label}
                  </span>
                  <span className="text-[12.5px] text-[var(--ink)]">{step.value}</span>
                </li>
              ))}
            </ol>

            <div className="tnum flex items-baseline justify-between gap-3 border-t-2 border-[var(--gold)] bg-[var(--gold-soft)]/45 px-4 py-3.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6a5518]">
                {deadline.trace.resultLabel}
              </span>
              <span className="serif text-[1.15rem] font-semibold">
                {deadlineTrace.resultValue}
              </span>
            </div>

            <figcaption className="space-y-1.5 border-t border-[var(--rule)] px-4 py-3 text-[12.5px] italic text-[var(--ink-soft)]">
              <p>{deadline.trace.note}</p>
              <p className="not-italic">{deadline.trace.engineNote}</p>
            </figcaption>
          </figure>
        </div>
      </Container>
    </Section>
  );
}
