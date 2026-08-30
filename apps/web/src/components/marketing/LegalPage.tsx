import { MarketingShell } from "./MarketingShell";
import { Container, Section, SectionHeading } from "./primitives";
import type { LegalDocument } from "./legal-content";

/**
 * Yasal metin sayfası gövdesi — KVKK aydınlatma, kullanım koşulları ve çerez
 * politikası aynı düzeni paylaşır.
 *
 * Bölümler `id` taşır: alt bilgideki ve formdaki bağlantılar doğrudan ilgili
 * maddeye iner. Çıpanın indiği yerde METNİN KENDİSİ durur — eski hâlde üç
 * cümlelik bir "tam metinler sözleşme sürecinde paylaşılır" kutusu vardı.
 */
export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker={doc.kicker} title={doc.title} lead={doc.lead} />

          <p className="tnum mt-6 text-sm text-[var(--ink-soft)]">
            Son güncelleme: {doc.updatedAt}
          </p>

          <ol className="mt-12 space-y-px overflow-hidden rounded-[5px] border border-[var(--rule)] bg-[var(--rule)]">
            {doc.sections.map((section, index) => (
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

                <div className="mt-3 space-y-3">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="text-[1rem] text-[var(--ink-soft)]">
                      {paragraph}
                    </p>
                  ))}
                </div>

                {section.bullets && section.bullets.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {section.bullets.map((bullet) => (
                      <li
                        key={bullet}
                        className="flex gap-3 text-[0.9375rem] text-[var(--ink-soft)]"
                      >
                        <span aria-hidden="true" className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-[#7a6220]" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          <p className="rule mt-10 pt-6 text-sm text-[var(--ink-soft)]">{doc.footnote}</p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
