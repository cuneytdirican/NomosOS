import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";
import { kvkkAydinlatma } from "@/components/marketing/legal-content";

/**
 * KVKK Aydınlatma Metni — demo formundaki onay bağlantısının hedefi.
 *
 * KVKK m.10 aydınlatma yükümlülüğü veri toplama ANINDA yerine getirilir; bu
 * yüzden metin, form gönderilmeden önce tam hâliyle erişilebilir olmalıdır.
 * Önceki hâlde bağlantı, aydınlatma metni İÇERMEYEN bir kutuya iniyordu.
 */
export const metadata: Metadata = {
  title: "KVKK Aydınlatma Metni",
  description:
    "NomosOS tanıtım sitesi üzerinden iletilen demo talebi ve iletişim verilerinin " +
    "işlenmesine ilişkin KVKK m.10 aydınlatma metni.",
};

export default function KvkkAydinlatmaPage() {
  return <LegalPage doc={kvkkAydinlatma} />;
}
