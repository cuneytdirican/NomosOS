import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, Section, SectionHeading } from "@/components/marketing/primitives";
import { about } from "@/components/marketing/content";

export const metadata: Metadata = {
  title: "Hakkımızda",
  description: "NomosOS'u kim, neden yapıyor: hukuk bürosunun günlük işini tek sistemde toplayan, avukatın kararını merkeze alan bir ekip.",
  alternates: { canonical: "/hakkimizda" },
};

export default function HakkimizdaPage() {
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker={about.kicker} title={about.title} lead={about.lead} />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {about.principles.map((p) => (
              <div key={p.title} className="rounded-[5px] border border-[var(--rule)] bg-white p-6">
                <h2 className="serif !text-[1.1rem]">{p.title}</h2>
                <p className="mt-3 text-[0.95rem] text-[var(--ink-soft)]">{p.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 max-w-[70ch] space-y-4">
            {about.story.map((paragraph) => (
              <p key={paragraph} className="text-[1.0625rem] leading-relaxed text-[var(--ink-soft)]">
                {paragraph}
              </p>
            ))}
          </div>
          <p className="mt-10 text-sm text-[var(--ink-soft)]">{about.footnote}</p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
