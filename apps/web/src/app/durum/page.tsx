import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, Section, SectionHeading } from "@/components/marketing/primitives";
import { StatusBoard } from "@/components/marketing/StatusBoard";

export const metadata: Metadata = {
  title: "Sistem durumu",
  description: "NomosOS bileşenlerinin anlık durumu (uygulama, veritabanı, kuyruk, depo) ve yayımlanmış duyurular.",
  alternates: { canonical: "/durum" },
  robots: { index: false },
};

export default function DurumPage() {
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker="DURUM" title="Sistem durumu" lead="Bileşen sağlığı sunucudan 30 saniyede bir okunur; kesinti hâlinde bu sayfa da etkilenebilir — o durumda e-posta ile ulaşın." />
          <StatusBoard />
        </Container>
      </Section>
    </MarketingShell>
  );
}
