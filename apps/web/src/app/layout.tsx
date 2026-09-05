import type { Metadata } from "next";
import "./globals.css";

/**
 * Kök düzen.
 *
 * Yazı tipi yığınları `globals.css` içinde CSS değişkeni olarak tanımlıdır
 * (`--font-serif-legal`, `--font-sans-legal`); Google Fonts kurulmaz, sistem
 * serif/sans yığınları kullanılır. Pazarlama paleti `.marketing` kapsamındadır,
 * uygulama sayfalarının (/app/**) mevcut teması korunur.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://nomosos.com").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "NomosOS — Büronuzun bütün işi. Tek sistemde.",
    template: "%s | NomosOS",
  },
  description:
    "Müvekkil, dosya, duruşma, süre, icra ve finans yönetimi; üzerinde çalışan bir yapay zekâ katmanı. Kendi yapay zekânızı bağlayın, verileriniz büronuzdan çıkmasın.",
  applicationName: "NomosOS",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    siteName: "NomosOS",
    title: "NomosOS — Büronuzun bütün işi. Tek sistemde.",
    description: "Türk hukuk büroları için AI-Native Legal OS: müvekkil, dosya, duruşma, süre, icra, finans ve üzerinde çalışan yapay zekâ katmanı.",
  },
  twitter: { card: "summary_large_image", title: "NomosOS", description: "Büronuzun bütün işi. Tek sistemde." },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="font-sans">{children}</body>
    </html>
  );
}
