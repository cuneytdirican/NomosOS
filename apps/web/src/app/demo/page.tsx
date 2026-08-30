import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, Section, SectionHeading } from "@/components/marketing/primitives";
import { DemoForm } from "@/components/marketing/DemoForm";
import { demo } from "@/components/marketing/content";

/** 3.12 Demo talebi — ayrı sayfa. */

export const metadata: Metadata = {
  title: "Demo Talep Edin",
  description:
    "Büronuzun kendi dosya yapısı üzerinden 30 dakikalık bir tanıtım için demo talebi oluşturun.",
};

export default function DemoPage() {
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker={demo.kicker} title={demo.title} lead={demo.lead} />

          <div className="mt-12 grid gap-10 lg:grid-cols-[1.35fr_1fr]">
            <DemoForm />

            <aside className="self-start rounded-[5px] border border-[var(--rule)] bg-[var(--paper-alt)] p-6">
              <h2 className="!text-[1.1rem]">{demo.sidebar.title}</h2>
              <ul className="mt-4 space-y-3">
                {demo.sidebar.items.map((item) => (
                  <li key={item} className="flex gap-3 text-sm text-[var(--ink-soft)]">
                    <span aria-hidden="true" className="mt-2 h-px w-4 shrink-0 bg-[var(--gold)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
