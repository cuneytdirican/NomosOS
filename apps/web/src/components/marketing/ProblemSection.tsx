import { Card, Container, Section, SectionHeading } from "./primitives";
import { problem } from "./content";

/** 3.2 Sorun — "Bir avukatın günü". */
export function ProblemSection() {
  return (
    <Section id="sorun" tone="alt">
      <Container>
        <SectionHeading kicker={problem.kicker} title={problem.title} />

        <div className="mt-6 max-w-3xl space-y-4 text-[1.0625rem] text-[var(--ink-soft)]">
          {problem.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <p>
            {problem.closing.before}
            <strong className="font-semibold text-[var(--ink)]">{problem.closing.strong}</strong>
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {problem.cards.map((card) => (
            <Card key={card.title}>
              <div className="mb-3 h-px w-10 bg-[var(--gold)]" aria-hidden="true" />
              <h3 className="!text-[1.05rem]">{card.title}</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{card.text}</p>
            </Card>
          ))}
        </div>
      </Container>
    </Section>
  );
}
