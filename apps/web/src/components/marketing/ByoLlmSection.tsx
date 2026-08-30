import { Container, Section, SectionHeading } from "./primitives";
import { byollm } from "./content";

/** 3.7 Veri egemenliği — altı sağlayıcı seçeneği ve yerel model vurgusu. */
export function ByoLlmSection() {
  return (
    <Section id="byo-llm" tone="ink">
      <Container>
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading kicker={byollm.kicker} title={byollm.title} lead={byollm.lead} onInk />
          </div>

          <div>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {byollm.providers.map((provider) => (
                <li
                  key={provider}
                  className="rounded-[4px] border border-white/20 px-4 py-3 text-[13.5px] text-[#E6E9F0]"
                >
                  {provider}
                </li>
              ))}
            </ul>

            <p className="mt-6 rounded-[4px] border-l-2 border-[var(--gold)] bg-white/[0.06] px-5 py-4 text-[15px] text-[#DDE2EC]">
              {byollm.callout}
            </p>
          </div>
        </div>

        <dl className="mt-14 grid gap-8 border-t border-white/15 pt-8 sm:grid-cols-3">
          {byollm.points.map((point) => (
            <div key={point.title}>
              <dt className="serif !text-[1.02rem] !font-semibold !text-[var(--paper)]">
                {point.title}
              </dt>
              <dd className="mt-2 text-sm text-[#C2CAD9]">{point.text}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </Section>
  );
}
