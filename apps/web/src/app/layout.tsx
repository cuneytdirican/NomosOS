import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NomosOS — Hukuk Büronuzun İşletim Sistemi",
    template: "%s | NomosOS",
  },
  description:
    "AI destekli dosya, müvekkil, duruşma, süre, icra ve finans yönetimi — Türk hukuk büroları için tek platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="font-sans">{children}</body>
    </html>
  );
}
