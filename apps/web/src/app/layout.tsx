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

export const metadata: Metadata = {
  title: {
    default: "NomosOS — Büronuzun bütün işi. Tek sistemde.",
    template: "%s | NomosOS",
  },
  description:
    "Müvekkil, dosya, duruşma, süre, icra ve finans yönetimi; üzerinde çalışan bir yapay zekâ katmanı. Kendi yapay zekânızı bağlayın, verileriniz büronuzdan çıkmasın.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="font-sans">{children}</body>
    </html>
  );
}
