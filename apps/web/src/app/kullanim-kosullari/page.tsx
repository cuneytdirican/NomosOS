import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";
import { kullanimKosullari } from "@/components/marketing/legal-content";

/** Kullanım koşulları — alt bilgideki "Yasal" sütununun hedefi. */
export const metadata: Metadata = {
  title: "Kullanım Koşulları",
  description:
    "NomosOS tanıtım sitesinin kullanım koşulları: kapsam, hukuki danışmanlık " +
    "verilmediği, fikri haklar ve sorumluluğun sınırı.",
};

export default function KullanimKosullariPage() {
  return <LegalPage doc={kullanimKosullari} />;
}
