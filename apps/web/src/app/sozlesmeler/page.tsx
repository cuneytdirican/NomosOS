import type { Metadata } from "next";
import Link from "next/link";
import { CONTRACT_DOCS } from "@nomosos/shared";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, Section, SectionHeading } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Sözleşme Seti",
  description: "Hizmet sözleşmesi, veri işleme protokolü, hizmet seviyesi taahhüdü ve mesafeli satış sözleşmesi.",
  alternates: { canonical: "/sozlesmeler" },
};

/** Faz 8B — sözleşme seti dizini. */
export default function SozlesmelerPage() {
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker="Yasal" title="Sözleşme seti" lead="Abonelik ilişkisini düzenleyen dört metin. Büro yöneticisi bu metinleri uygulama içinden (Ayarlar → Sözleşmeler) büro adına kabul eder; kabul kaydı sürüm ve tarih ile saklanır." />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {CONTRACT_DOCS.map((d) => (
              <li key={d.key} className="rounded-[5px] border border-[var(--rule)] bg-white p-6">
                <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">{d.kicker}</p>
                <h2 className="mt-1 !text-[1.15rem]">
                  <Link href={`/sozlesmeler/${d.slug}`} className="underline-offset-4 hover:underline">
                    {d.title}
                  </Link>
                </h2>
                <p className="mt-2 text-sm text-[var(--ink-soft)]">{d.lead}</p>
                <p className="tnum mt-3 text-xs text-[var(--ink-soft)]">
                  Sürüm {d.version} · {d.updatedAt} · {d.required ? "Zorunlu" : "Bilgilendirici"}
                </p>
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </MarketingShell>
  );
}
