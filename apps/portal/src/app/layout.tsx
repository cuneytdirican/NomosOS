import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Portal kök düzeni.
 *
 * Yazı tipleri sistem yığınlarıdır (Google Fonts kurulmaz) — `globals.css`
 * içindeki `--font-serif-legal` / `--font-sans-legal` değişkenleri.
 *
 * Portal kişisel veri gösterir: arama motorlarına kapalıdır (`robots: noindex`
 * ve `next.config.ts` içinde `X-Robots-Tag`).
 */

export const metadata: Metadata = {
  title: {
    default: "Müvekkil Portalı",
    template: "%s · Müvekkil Portalı",
  },
  description:
    "Dosyalarınızın durumunu, duruşmalarınızı, paylaşılan belgeleri ve ödemelerinizi tek yerden takip edin.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FBF9F5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
