import { Card, Container, Section, SectionHeading } from "./primitives";
import { ai } from "./content";

/**
 * 3.6 Yapay zekâ — dört kart + uydurma içtihat (halüsinasyon) şeridi.
 * Görsel dil bilinçli olarak tipografiktir: robot, beyin, nöron ağı görseli kullanılmaz.
 */
export function AiSection() {
  return (
    <Section id="yapay-zeka" tone="alt">
      <Container>
        <SectionHeading kicker={ai.kicker} title={ai.title} lead={ai.lead} />

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {ai.cards.map((card) => (
            <Card key={card.title}>
              <h3 className="!text-[1.05rem]">{card.title}</h3>
              <p className="mt-2.5 text-sm text-[var(--ink-soft)]">{card.text}</p>
            </Card>
          ))}
        </div>

        {/* Halüsinasyon şeridi */}
        <div className="mt-8 rounded-[5px] border border-[var(--gold)] bg-white p-6 sm:p-8">
          <h3 className="!text-[1.15rem]">{ai.hallucination.title}</h3>
          <p className="mt-3 text-[1rem] text-[var(--ink-soft)]">
            {ai.hallucination.text}{" "}
            <strong className="font-semibold text-[var(--ink)]">{ai.hallucination.strong}</strong>
          </p>
        </div>
      </Container>
    </Section>
  );
}
