import { Container, PrimaryButton, SecondaryButton } from "./primitives";
import { DashboardMockup } from "./DashboardMockup";
import { hero } from "./content";

/** 3.1 Hero — ana vaat, iki düğme, güven şeridi ve panel mockup'ı. */
export function Hero() {
  return (
    <section className="bg-[var(--paper)] pb-16 pt-14 sm:pb-20 sm:pt-20">
      <Container>
        <div className="fade-in grid items-start gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
          <div>
            <p className="kicker">{hero.kicker}</p>
            <h1 className="mt-4 text-[2.1rem] sm:text-[2.9rem]">{hero.title}</h1>
            <p className="mt-6 max-w-xl text-[1.0625rem] text-[var(--ink-soft)]">{hero.lead}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryButton href={hero.primary.href}>{hero.primary.label}</PrimaryButton>
              <SecondaryButton href={hero.secondary.href}>{hero.secondary.label}</SecondaryButton>
            </div>

            <ul className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[var(--ink-soft)]">
              {hero.trustStrip.map((item, index) => (
                <li key={item} className="flex items-center gap-3">
                  {index > 0 && (
                    <span aria-hidden="true" className="text-[var(--gold)]">
                      ·
                    </span>
                  )}
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:pt-6">
            <DashboardMockup />
          </div>
        </div>
      </Container>
    </section>
  );
}
