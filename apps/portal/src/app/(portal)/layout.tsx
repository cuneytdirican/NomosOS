"use client";

/**
 * Portal kabuğu — oturum kontrolü, üst çubuk, gezinme ve alt bilgi.
 *
 * Gezinme TEK satırdır ve yedi girişten oluşur; dar ekranda yatay kayar.
 * Büro panelindeki gibi bir kenar çubuğu bilinçli olarak yoktur: müvekkilin
 * ekranında ne kadar az yapı varsa o kadar iyidir.
 */

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PortalSessionProvider, usePortalSession } from "@/lib/session";
import { NAV_ITEMS, isActivePath } from "@/lib/nav";
import { PortalMark } from "@/components/AuthShell";
import { Credit } from "@/components/Credit";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <PortalSessionProvider>
      <Shell>{children}</Shell>
    </PortalSessionProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, authenticated, user, apiUnavailable, logout } = usePortalSession();

  useEffect(() => {
    if (ready && !authenticated) router.replace("/giris");
  }, [ready, authenticated, router]);

  // OTURUM KONTROL EKRANI.
  //
  // Künye (`<Credit />`) burada da yer alır. Panelin altbilgisi ve `/giris`
  // ekranı zaten künyeyi taşır, ama `/` adresinin SUNUCUDAN DÖNEN HTML'i
  // yalnızca bu bloktur: oturum `localStorage`'tan istemcide çözüldüğü için
  // kabuk ancak tarayıcıda kurulur. Künyesiz kalan tek görünüm buydu ve
  // sayfa kaynağına bakan bir denetimde "künye yok" olarak görünüyordu.
  if (!ready || !authenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-paper px-6 text-center text-[15px] text-ink-faint">
        <p>Oturumunuz kontrol ediliyor…</p>
        <Credit />
      </div>
    );
  }

  const displayName = user?.fullName ?? user?.email ?? "";
  const clientName = user?.clientName;
  const officeName = user?.tenantName;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <Link href="/" className="flex items-center gap-3 rounded-xl">
            <PortalMark className="h-9 w-9" />
            <span className="leading-tight">
              <span className="block font-serif text-[15px] font-semibold text-ink">
                Müvekkil Portalı
              </span>
              {officeName && (
                <span className="block text-[13px] text-ink-faint">{officeName}</span>
              )}
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              {clientName && (
                <p className="text-sm font-medium text-ink">{clientName}</p>
              )}
              {displayName && (
                <p className="text-[13px] text-ink-faint">{displayName}</p>
              )}
            </div>
            <button
              type="button"
              onClick={logout}
              className="rounded-xl border border-rule bg-white px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-alt"
            >
              Çıkış
            </button>
          </div>
        </div>

        <nav
          aria-label="Portal menüsü"
          className="mx-auto max-w-5xl overflow-x-auto px-5 pb-2"
        >
          <ul className="flex min-w-max items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-block rounded-full px-4 py-2 text-[15px] font-medium transition-colors ${
                      active
                        ? "bg-ink text-paper"
                        : "text-ink-soft hover:bg-paper-alt hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      {apiUnavailable && (
        <div className="border-b border-[#EBDBB4] bg-calm-amberSoft">
          <p className="mx-auto max-w-5xl px-5 py-2.5 text-sm text-calm-amber">
            Bilgileriniz şu anda güncellenemiyor. Gördüğünüz veriler eksik olabilir;
            kısa süre sonra tekrar bakın.
          </p>
        </div>
      )}

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 fade-in">{children}</main>

      <footer className="mt-8 border-t border-rule">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-6 text-sm text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-reading leading-relaxed">
            Bu portalda yalnızca avukatınızın sizinle paylaştığı bilgiler görünür.
            Kişisel verileriniz KVKK kapsamında korunur.
          </p>
          <Credit className="shrink-0" />
        </div>
      </footer>
    </div>
  );
}
