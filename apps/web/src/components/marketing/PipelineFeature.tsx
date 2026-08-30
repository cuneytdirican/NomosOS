import { Container, Section, SectionHeading } from "./primitives";
import { pipeline } from "./content";

/**
 * 3.5 Öne çıkan: Belge → Aksiyon hattı.
 * Altı adımlı dikey akış, altın çizgiyle bağlanır; yanında "onaysız kayıt oluşmaz" vurgusu.
 */
export function PipelineFeature() {
  return (
    <Section id="belge">
      <Container>
        <SectionHeading kicker={pipeline.kicker} title={pipeline.title} lead={pipeline.lead} />

        <div className="mt-12 grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          {/* Dikey akış */}
          <ol className="relative">
            <span
              aria-hidden="true"
              className="absolute bottom-6 left-[9px] top-3 w-px bg-[var(--gold)] opacity-50"
            />
            {pipeline.steps.map((step, index) => (
              <li key={step.title} className="relative flex gap-5 pb-7 last:pb-0">
                <span
                  aria-hidden="true"
                  className="relative z-10 mt-1 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border border-[var(--gold)] bg-[var(--paper)] text-[10.5px] font-semibold text-[#7a6220]"
                >
                  {index + 1}
                </span>
                <span>
                  <span className="serif block text-[1.02rem] font-semibold text-[var(--ink)]">
                    {step.title}
                  </span>
                  {step.detail && (
                    <span className="mt-0.5 block text-sm text-[var(--ink-soft)]">
                      {step.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {/* Vurgu kutusu */}
          <aside className="self-start rounded-[5px] border border-[var(--gold)] bg-[var(--gold-soft)]/35 p-6 sm:p-7">
            <h3 className="!text-[1.15rem]">{pipeline.callout.title}</h3>
            <p className="mt-3 text-[1rem] text-[var(--ink-soft)]">{pipeline.callout.text}</p>
          </aside>
        </div>
      </Container>
    </Section>
  );
}
