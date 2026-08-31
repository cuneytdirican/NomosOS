/**
 * Oturum dışı ekranların (giriş, davet kabul) ortak kabuğu.
 *
 * Tek sütun, geniş boşluk, büyük punto. Bu ekranı çoğu zaman telefondan,
 * ilk kez ve biraz tedirgin biri açacak: sayfada tek bir iş, tek bir düğme
 * ve bir güven cümlesi olur.
 */

import type { ReactNode } from "react";
import { Credit } from "./Credit";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-md fade-in">
          <div className="mb-8 text-center">
            <PortalMark className="mx-auto mb-5" />
            <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-ink">
              {title}
            </h1>
            {subtitle && (
              <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-ink-soft">
                {subtitle}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-rule bg-white px-6 py-7 shadow-paper sm:px-8">
            {children}
          </div>

          <p className="mt-6 text-center text-sm leading-relaxed text-ink-faint">
            Bu portalda yalnızca avukatınızın sizinle paylaştığı bilgiler görünür.
            Kişisel verileriniz KVKK kapsamında korunur.
          </p>
        </div>
      </main>

      <footer className="border-t border-rule px-5 py-5 text-center">
        <Credit />
      </footer>
    </div>
  );
}

/** Portal ambleminin sade hâli — terazi değil, mühür/kağıt izlenimi. */
export function PortalMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="NomosOS Müvekkil Portalı"
      className={`h-12 w-12 ${className}`}
    >
      <rect x="1" y="1" width="46" height="46" rx="12" className="fill-ink" />
      <path
        d="M15 33V15h4.2l9.6 12.4V15H33v18h-4.2L19.2 20.6V33H15z"
        className="fill-paper"
      />
      <rect x="15" y="36" width="18" height="2" rx="1" className="fill-gold" />
    </svg>
  );
}
