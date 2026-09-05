import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, PrimaryButton, Section, SectionHeading } from "@/components/marketing/primitives";
import { extension } from "@/components/marketing/content";

export const metadata: Metadata = {
  title: "UYAP Köprüsü eklentisi",
  description: "NomosOS UYAP Köprüsü tarayıcı eklentisini indirin: UYAP Avukat Portalı'ndaki dosya, safahat ve evrakı okur; sizin adınıza hiçbir evrak göndermez.",
  alternates: { canonical: "/eklenti" },
};

export default function EklentiPage() {
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker={extension.kicker} title={extension.title} lead={extension.lead} />
          <div className="mt-10 rounded-[5px] border border-[var(--gold)] bg-[var(--gold-soft)]/30 p-6 sm:p-8">
            <p className="tnum text-sm text-[var(--ink-soft)]">Sürüm {extension.version} · Chrome / Edge (Manifest V3) · {extension.sizeNote}</p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <PrimaryButton href={extension.downloadHref}>{extension.downloadLabel}</PrimaryButton>
              <a href={extension.checksumHref} className="text-sm text-[var(--ink-soft)] underline underline-offset-2">
                SHA-256 özeti
              </a>
            </div>
            <p className="mt-3 text-xs text-[var(--ink-soft)]">{extension.storeNote}</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <div className="rounded-[5px] border border-[var(--rule)] bg-white p-6">
              <h2 className="serif !text-[1.1rem]">Kurulum</h2>
              <ol className="mt-3 space-y-2 text-[0.95rem] text-[var(--ink-soft)]">
                {extension.steps.map((s, i) => (
                  <li key={s} className="flex gap-3">
                    <span className="tnum serif font-semibold text-[#7a6220]">{String(i + 1).padStart(2, "0")}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-[5px] border border-[var(--rule)] bg-white p-6">
              <h2 className="serif !text-[1.1rem]">Ne yapar, ne yapmaz</h2>
              <ul className="mt-3 space-y-2 text-[0.95rem] text-[var(--ink-soft)]">
                {extension.guarantees.map((g) => (
                  <li key={g} className="flex gap-3">
                    <span aria-hidden="true" className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-[#7a6220]" />
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-[var(--ink-soft)]">
                Eşleştirme kodunu uygulama içindeki{" "}
                <Link href="/giris" className="underline underline-offset-2">
                  UYAP Köprüsü
                </Link>{" "}
                sayfasından alırsınız.
              </p>
            </div>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
