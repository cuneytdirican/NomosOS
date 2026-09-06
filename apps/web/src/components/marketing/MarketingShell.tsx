import type { ReactNode } from "react";
import { MindAeonBanner } from "./MindAeonBanner";
import { SiteHeader } from "./SiteHeader";
import { Footer } from "./Footer";

/**
 * Pazarlama sayfalarının dış kabuğu.
 *
 * `.marketing` sınıfı, kağıt paletini ve serif/sans yığınlarını yalnızca bu ağaçta
 * geçerli kılar; uygulama (/app/**) ve giriş sayfası kendi temasıyla çalışmaya devam eder.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  // overflow-x-clip: yatay taşmayı keser ama kaydırma kabı oluşturmadığı için
  // üstteki sticky gezinme çubuğunu bozmaz (overflow-x-hidden bunu bozardı).
  return (
    <div className="marketing min-h-screen overflow-x-clip">
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[4px] focus:bg-[var(--ink)] focus:px-4 focus:py-2 focus:text-sm focus:text-[var(--paper)]"
      >
        İçeriğe geç
      </a>
      <MindAeonBanner />
      <SiteHeader />
      <main id="icerik">{children}</main>
      <Footer />
    </div>
  );
}
