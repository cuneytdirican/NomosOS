import { Container, Section } from "./primitives";
import { closing } from "./content";

/** 3.12 Kapanış — demo çağrısı. */
export function ClosingSection() {
  return (
    <Section id="demo-cagri">
      <Container>
        <div className="rounded-[6px] border border-[var(--rule)] bg-white px-6 py-12 text-center sm:px-12">
          <h2 className="mx-auto max-w-2xl text-[1.75rem] sm:text-[2.15rem]">{closing.title}</h2>
          {closing.paragraphs.map((paragraph) => (
            <p
              key={paragraph}
              className="mx-auto mt-5 max-w-2xl text-[1.0625rem] text-[var(--ink-soft)]"
            >
              {paragraph}
            </p>
          ))}
          <a
            href={closing.cta.href}
            className="mt-8 inline-flex items-center justify-center rounded-[4px] bg-[var(--ink)] px-7 py-3 text-sm font-semibold text-[var(--paper)] transition-colors hover:bg-[#16264a]"
          >
            {closing.cta.label}
          </a>
        </div>
      </Container>
    </Section>
  );
}
