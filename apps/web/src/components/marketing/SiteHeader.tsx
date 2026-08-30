import Link from "next/link";
import { Logo } from "./Logo";
import { Container } from "./primitives";
import { nav } from "./content";

/**
 * Üst gezinme: Logo · Özellikler · Güvenlik · Fiyatlandırma · SSS · Giriş Yap · Demo Talep Edin.
 * Mobilde bağlantılar JavaScript'siz bir <details> menüsüne iner (klavyeyle gezilebilir).
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--paper)]/95 backdrop-blur-sm">
      <Container className="flex items-center justify-between gap-4 py-3.5">
        <Link href="/" aria-label="NomosOS ana sayfa">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Ana gezinme">
          {nav.links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-sm text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <Link
            href={nav.login.href}
            className="text-sm font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
          >
            {nav.login.label}
          </Link>
          <Link
            href={nav.cta.href}
            className="rounded-[4px] bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--paper)] transition-colors hover:bg-[#16264a]"
          >
            {nav.cta.label}
          </Link>
        </div>

        {/* Mobil menü */}
        <details className="relative md:hidden">
          <summary
            className="rounded-[4px] border border-[var(--rule)] px-3 py-1.5 text-sm font-medium text-[var(--ink)]"
            aria-label="Menüyü aç"
          >
            Menü
          </summary>
          <div className="absolute right-0 z-50 mt-2 w-60 rounded-[5px] border border-[var(--rule)] bg-white p-2 shadow-sm">
            <nav aria-label="Mobil gezinme" className="flex flex-col">
              {nav.links.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="rounded-[3px] px-3 py-2 text-sm text-[var(--ink-soft)] hover:bg-[var(--paper-alt)]"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href={nav.login.href}
                className="rounded-[3px] px-3 py-2 text-sm text-[var(--ink-soft)] hover:bg-[var(--paper-alt)]"
              >
                {nav.login.label}
              </Link>
              <Link
                href={nav.cta.href}
                className="mt-1 rounded-[4px] bg-[var(--ink)] px-3 py-2 text-center text-sm font-semibold text-[var(--paper)]"
              >
                {nav.cta.label}
              </Link>
            </nav>
          </div>
        </details>
      </Container>
    </header>
  );
}
