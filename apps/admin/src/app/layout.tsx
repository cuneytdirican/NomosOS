import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NomosOS Yönetim Paneli",
    template: "%s · NomosOS Yönetim",
  },
  description:
    "NomosOS platform operasyon paneli — tenant yaşam döngüsü, abonelik, ödeme, AI analitiği, sistem sağlığı ve denetim izi.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="font-sans">{children}</body>
    </html>
  );
}
