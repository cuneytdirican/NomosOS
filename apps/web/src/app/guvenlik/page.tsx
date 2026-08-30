import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, Section, SectionHeading } from "@/components/marketing/primitives";
import { security } from "@/components/marketing/content";

/** 3.9 Güvenlik ve KVKK — ayrı sayfa. */

export const metadata: Metadata = {
  title: "Güvenlik ve KVKK",
  description:
    "Kişisel veri tespiti ve maskeleme, yerel model seçeneği, denetim izi, erişim yetkileri ve destek erişimi ilkeleri.",
};

export default function GuvenlikPage() {
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading
            kicker={security.kicker}
            title={security.title}
            lead={security.lead}
          />

          <ol className="mt-14 space-y-px overflow-hidden rounded-[5px] border border-[var(--rule)] bg-[var(--rule)]">
            {security.sections.map((section, index) => (
              <li key={section.id} id={section.id} className="scroll-mt-24 bg-white p-6 sm:p-8">
                <div className="flex items-baseline gap-3">
                  <span
                    className="tnum serif text-[0.95rem] font-semibold !text-[#7a6220]"
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2 className="!text-[1.15rem]">{section.title}</h2>
                </div>
                <p className="mt-3 text-[1rem] text-[var(--ink-soft)]">
                  {section.strong ? (
                    <SplitEmphasis text={section.text} strong={section.strong} />
                  ) : (
                    section.text
                  )}
                </p>
              </li>
            ))}
          </ol>

          <div
            id="kvkk-aydinlatma"
            className="mt-12 scroll-mt-24 space-y-3 rounded-[5px] border border-[var(--rule)] bg-[var(--paper-alt)] p-6 text-sm text-[var(--ink-soft)]"
          >
            {security.legalNotes.map((note) => (
              <p key={note.id} id={note.id} className="scroll-mt-24">
                {note.text}
              </p>
            ))}
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}

/** Metnin içindeki vurgulanacak cümleyi kalın gösterir. */
function SplitEmphasis({ text, strong }: { text: string; strong: string }) {
  const index = text.indexOf(strong);
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <strong className="font-semibold text-[var(--ink)]">{strong}</strong>
      {text.slice(index + strong.length)}
    </>
  );
}
