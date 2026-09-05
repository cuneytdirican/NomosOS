import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CONTRACT_DOCS, findContractDoc } from "@nomosos/shared";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, Section, SectionHeading } from "@/components/marketing/primitives";

/** Faz 8B — sözleşme seti (Hizmet/EULA, DPA, SLA, Mesafeli satış); metin @nomosos/shared'dan (tek kaynak). */

export function generateStaticParams() {
  return CONTRACT_DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = findContractDoc(slug);
  if (!doc) return { title: "Sözleşme bulunamadı" };
  return { title: doc.title, description: doc.lead, alternates: { canonical: `/sozlesmeler/${doc.slug}` } };
}

export default async function SozlesmePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = findContractDoc(slug);
  if (!doc) notFound();
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker={doc.kicker} title={doc.title} lead={doc.lead} />
          <p className="tnum mt-6 text-sm text-[var(--ink-soft)]">
            Sürüm {doc.version} · Son güncelleme: {doc.updatedAt}
          </p>
          <p className="mt-4 rounded-[5px] border border-[var(--gold)] bg-[var(--gold-soft)]/30 p-4 text-sm text-[var(--ink)]" data-testid="taslak-uyarisi">
            {doc.draftNotice}
          </p>
          <ol className="mt-10 space-y-px overflow-hidden rounded-[5px] border border-[var(--rule)] bg-[var(--rule)]">
            {doc.sections.map((section, index) => (
              <li key={section.id} id={section.id} className="scroll-mt-24 bg-white p-6 sm:p-8">
                <div className="flex items-baseline gap-3">
                  <span className="tnum serif text-[0.95rem] font-semibold !text-[#7a6220]" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2 className="!text-[1.15rem]">{section.title}</h2>
                </div>
                <div className="mt-3 space-y-3">
                  {section.paragraphs.map((p) => (
                    <p key={p} className="text-[1rem] text-[var(--ink-soft)]">
                      {p}
                    </p>
                  ))}
                </div>
                {section.bullets && (
                  <ul className="mt-4 space-y-2">
                    {section.bullets.map((b) => (
                      <li key={b} className="flex gap-3 text-[0.9375rem] text-[var(--ink-soft)]">
                        <span aria-hidden="true" className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-[#7a6220]" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-10 text-sm text-[var(--ink-soft)]">
            Diğer metinler:{" "}
            {CONTRACT_DOCS.filter((d) => d.slug !== doc.slug).map((d, i) => (
              <span key={d.slug}>
                {i > 0 ? " · " : ""}
                <Link href={`/sozlesmeler/${d.slug}`} className="underline underline-offset-2">
                  {d.title}
                </Link>
              </span>
            ))}
          </p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
