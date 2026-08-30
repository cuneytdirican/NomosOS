import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";
import { cerezPolitikasi } from "@/components/marketing/legal-content";

/** Çerez politikası — alt bilgideki "Yasal" sütununun hedefi. */
export const metadata: Metadata = {
  title: "Çerez Politikası",
  description:
    "NomosOS tanıtım sitesinde kullanılan çerezler: yalnız zorunlu çerezler, " +
    "reklam veya profilleme amaçlı izleme yapılmaz.",
};

export default function CerezPolitikasiPage() {
  return <LegalPage doc={cerezPolitikasi} />;
}
