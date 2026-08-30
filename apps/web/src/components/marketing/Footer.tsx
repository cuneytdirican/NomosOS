import Link from "next/link";
import { Logo } from "./Logo";
import { Container } from "./primitives";
import { footer, site } from "./content";

/**
 * Alt bilgi (docs/08 §3.13).
 * Telif satırıyla aynı hizada geliştirici künyesi bulunur:
 * Developed by MindAeon AI → https://mindaeon.com (rel="noopener noreferrer" zorunlu).
 */
export function Footer() {
  return (
    <footer className="border-t border-[var(--rule)] bg-[var(--paper-alt)]">
      <Container className="py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-[var(--ink-soft)]">{footer.blurb}</p>
          </div>

          {footer.columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="serif !text-[0.95rem] !font-semibold">{column.title}</h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.label}`}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--ink-soft)] transition-colors hover:text-[#7a6220]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div>
            <h2 className="serif !text-[0.95rem] !font-semibold">{footer.contactColumn.title}</h2>
            <ul className="mt-3 space-y-2">
              {footer.contactColumn.lines.map((line) => (
                <li key={line}>
                  <a
                    href={`mailto:${line}`}
                    className="text-sm text-[var(--ink-soft)] transition-colors hover:text-[#7a6220]"
                  >
                    {line}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="rule mt-12 pt-6 text-sm text-[var(--ink-soft)]">{site.legalNote}</p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-[var(--ink-soft)] opacity-70">
            {site.copyright}. Tüm hakları saklıdır.
          </p>
          <p className="credit">
            {site.credit.prefix}{" "}
            <a href={site.credit.href} target="_blank" rel="noopener noreferrer">
              {site.credit.label}
            </a>
          </p>
        </div>
      </Container>
    </footer>
  );
}
