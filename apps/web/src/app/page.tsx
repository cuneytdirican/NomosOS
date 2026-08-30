import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Hero } from "@/components/marketing/Hero";
import { ProblemSection } from "@/components/marketing/ProblemSection";
import { ModulesGrid } from "@/components/marketing/ModulesGrid";
import { DeadlineFeature } from "@/components/marketing/DeadlineFeature";
import { PipelineFeature } from "@/components/marketing/PipelineFeature";
import { AiSection } from "@/components/marketing/AiSection";
import { ByoLlmSection } from "@/components/marketing/ByoLlmSection";
import { UyapSection } from "@/components/marketing/UyapSection";
import { FaqSection } from "@/components/marketing/FaqSection";
import { ClosingSection } from "@/components/marketing/ClosingSection";
import { GoldRule } from "@/components/marketing/primitives";

/**
 * NomosOS tanıtım sitesi — tek sayfa (uzun kaydırmalı).
 * İçerik ve tasarım dili: docs/08-tanitim-sitesi-icerik.md
 */

export const metadata: Metadata = {
  title: "NomosOS — Büronuzun bütün işi. Tek sistemde.",
  description:
    "Müvekkil, dosya, duruşma, süre, icra ve finans yönetimi; üzerinde çalışan bir yapay zekâ katmanı. Kendi yapay zekânızı bağlayın, verileriniz büronuzdan çıkmasın.",
};

export default function MarketingPage() {
  return (
    <MarketingShell>
      <Hero />
      <GoldRule />
      <ProblemSection />
      <ModulesGrid />
      <DeadlineFeature />
      <PipelineFeature />
      <AiSection />
      <ByoLlmSection />
      <UyapSection />
      <FaqSection />
      <ClosingSection />
    </MarketingShell>
  );
}
