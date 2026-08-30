import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  Container,
  PrimaryButton,
  Section,
  SectionHeading,
} from "@/components/marketing/primitives";
import { pricing } from "@/components/marketing/content";

/** 3.10 Fiyatlandırma — üç plan tablosu + kredi sistemi açıklaması. */

export const metadata: Metadata = {
  title: "Fiyatlandırma",
  description:
    "Solo, Büro ve Kurumsal planlar; yapay zekâ kredisi nasıl çalışır, kredi tüketmeyen işlemler ve krediniz biterse ne olur.",
};

export default function FiyatlandirmaPage() {
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker={pricing.kicker} title={pricing.title} lead={pricing.lead} />

          {/* Plan karşılaştırma tablosu — mobilde yatay kaydırılır */}
          <div className="mt-12 overflow-x-auto rounded-[5px] border border-[var(--rule)] bg-white">
            <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
              <caption className="sr-only">{pricing.a11y.tableCaption}</caption>
              <thead>
                <tr className="border-b border-[var(--rule)] bg-[var(--paper-alt)]">
                  <th scope="col" className="w-[22rem] px-5 py-4 font-medium text-[var(--ink-soft)]">
                    <span className="sr-only">{pricing.a11y.featureColumn}</span>
                  </th>
                  {pricing.plans.map((plan) => (
                    <th key={plan} scope="col" className="px-5 py-4">
                      <span className="serif block text-[1.1rem] font-semibold text-[var(--ink)]">
                        {plan}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pricing.rows.map((row) => (
                  <tr key={row.label} className="border-b border-[var(--rule)] last:border-b-0">
                    <th
                      scope="row"
                      className="px-5 py-3.5 text-left font-medium text-[var(--ink)]"
                    >
                      {row.label}
                    </th>
                    {row.values.map((value, index) => (
                      <td
                        key={`${row.label}-${pricing.plans[index]}`}
                        className="px-5 py-3.5 align-top text-[var(--ink-soft)]"
                      >
                        {value === "✓" ? (
                          <span className="text-[#7a6220]">
                            <span aria-hidden="true">✓</span>
                            <span className="sr-only">{pricing.a11y.included}</span>
                          </span>
                        ) : value === "—" ? (
                          <span>
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{pricing.a11y.notIncluded}</span>
                          </span>
                        ) : (
                          value
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Kredi sistemi açıklaması */}
          <div className="mt-10 rounded-[5px] border border-[var(--gold)] bg-[var(--gold-soft)]/30 p-6 sm:p-8">
            <h2 className="!text-[1.25rem]">{pricing.credits.title}</h2>
            <p className="mt-3 max-w-3xl text-[1rem] text-[var(--ink-soft)]">
              {pricing.credits.intro}
            </p>

            <dl className="mt-7 grid gap-6 md:grid-cols-3">
              {pricing.credits.blocks.map((block) => (
                <div
                  key={block.title}
                  className="rounded-[4px] border border-[var(--rule)] bg-white p-5"
                >
                  <dt className="serif !text-[1rem] !font-semibold text-[var(--ink)]">
                    {block.title}
                  </dt>
                  <dd className="mt-2 text-sm text-[var(--ink-soft)]">{block.text}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm italic text-[var(--ink-soft)]">{pricing.footnote}</p>
            <PrimaryButton href={pricing.cta.href}>{pricing.cta.label}</PrimaryButton>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
