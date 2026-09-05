import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, PrimaryButton, Section, SectionHeading } from "@/components/marketing/primitives";
import { contact, site } from "@/components/marketing/content";

export const metadata: Metadata = {
  title: "İletişim",
  description: "Demo, satış, destek ve KVKK başvuruları için NomosOS iletişim kanalları.",
  alternates: { canonical: "/iletisim" },
};

export default function IletisimPage() {
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker={contact.kicker} title={contact.title} lead={contact.lead} />
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {contact.channels.map((c) => (
              <div key={c.title} className="rounded-[5px] border border-[var(--rule)] bg-white p-6">
                <h2 className="serif !text-[1.1rem]">{c.title}</h2>
                <p className="mt-2 text-[0.95rem] text-[var(--ink-soft)]">{c.text}</p>
                <p className="mt-3">
                  <a href={`mailto:${c.email}`} className="text-[#7a6220] underline underline-offset-2">
                    {c.email}
                  </a>
                </p>
                {c.sla && <p className="mt-1 text-xs text-[var(--ink-soft)]">{c.sla}</p>}
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <PrimaryButton href="/demo">Demo talep edin</PrimaryButton>
            <Link href="/durum" className="text-sm text-[var(--ink-soft)] underline underline-offset-2">
              Sistem durumu
            </Link>
          </div>
          <p className="mt-10 text-sm text-[var(--ink-soft)]">{site.legalNote}</p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
