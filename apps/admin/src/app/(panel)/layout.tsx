"use client";

/**
 * Panel kabuğu — oturum kontrolü, rol bazlı menü ve üst çubuk.
 * Menü yalnız rolün görebildiği sayfaları listeler (RoleGate ile aynı matris).
 * ANALYST_READONLY yalnız yatırımcı görünümünü görür; diğer bağlantılar menüde yoktur.
 */

import { useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AdminSessionProvider, useAdminSession } from "@/lib/session";
import { ANALYST_NAV, NAV_ITEMS } from "@/lib/nav";
import { EP } from "@/lib/endpoints";
import { useListResource } from "@/lib/useResource";
import { can, isAnalyst } from "@/lib/rbac";
import { ROLE_LABELS, ROLE_TONES } from "@/lib/labels";
import type { AdminApprovalRequest } from "@/lib/types";
import { Badge } from "@/components/ui";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <Shell>{children}</Shell>
    </AdminSessionProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, authenticated, role, user, apiUnavailable, logout } = useAdminSession();

  useEffect(() => {
    if (ready && !authenticated) router.replace("/giris");
  }, [ready, authenticated, router]);

  const items = useMemo(() => {
    if (!role) return [];
    if (isAnalyst(role)) return ANALYST_NAV;
    return NAV_ITEMS.filter((i) => can(role, i.action));
  }, [role]);

  // Bekleyen onay rozetini gerçek uçtan besle; uç yoksa rozet hiç gösterilmez.
  const approvals = useListResource<AdminApprovalRequest>(
    ready && authenticated && can(role, "approval.view") ? EP.approvals.list : null,
    { query: { status: "BEKLIYOR" } },
  );
  const pendingApprovals = approvals.data.filter((a) => a.status === "BEKLIYOR").length;

  if (!ready || !authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-steel-950 text-sm text-steel-400">
        Oturum doğrulanıyor…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-steel-950">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-steel-800 bg-steel-900">
        <div className="flex items-center gap-2 border-b border-steel-800 px-5 py-4">
          <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
            <rect width="32" height="32" rx="8" className="fill-accent-600" />
            <path d="M9 22V10h2.6l6 8.2V10H20v12h-2.6l-6-8.2V22H9z" className="fill-white" />
          </svg>
          <div className="leading-tight">
            <p className="text-sm font-bold text-steel-50">
              Nomos<span className="text-accent-400">OS</span>
            </p>
            <p className="text-[11px] uppercase tracking-wide text-steel-500">Yönetim Paneli</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Panel menüsü">
          {items.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-accent-600 text-white"
                    : "text-steel-300 hover:bg-steel-800 hover:text-steel-50"
                }`}
              >
                <span>{item.label}</span>
                {item.href === "/onaylar" && pendingApprovals > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-steel-950">
                    {pendingApprovals}
                  </span>
                )}
              </Link>
            );
          })}
          {items.length === 0 && (
            <p className="px-3 py-4 text-xs text-steel-500">
              Rolünüze açık bir ekran bulunmuyor.
            </p>
          )}
        </nav>

        <div className="border-t border-steel-800 px-5 py-3 text-[11px] leading-relaxed text-steel-500">
          <p>Platform operasyonu · impersonation yoktur</p>
          <p className="mt-1">Tenant verisine tek kapı: süreli, maskeli destek erişimi</p>
        </div>
      </aside>

      <div className="ml-60 flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-end gap-3 border-b border-steel-800 bg-steel-900/95 px-6 py-3 backdrop-blur">
          {apiUnavailable && (
            <Badge
              tone="yellow"
              title="GET /api/admin/v1/auth/me yanıt vermiyor; rol bilgisi son girişten okunuyor."
            >
              API ERİŞİLEMİYOR
            </Badge>
          )}
          {role && isAnalyst(role) && (
            <Badge tone="steel" title="Bu rolde hiçbir yazma işlemi yapılamaz.">
              SALT-OKUR
            </Badge>
          )}
          {role && <Badge tone={ROLE_TONES[role]}>{ROLE_LABELS[role]}</Badge>}
          <div className="text-right">
            <p className="text-sm font-medium text-steel-100">
              {user?.fullName ?? user?.email ?? "Kullanıcı"}
            </p>
            <p className="text-xs text-steel-500">{user?.email}</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-600 text-sm font-semibold text-white">
            {(user?.fullName ?? user?.email ?? "?").charAt(0).toUpperCase()}
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-md border border-steel-700 px-3 py-1.5 text-xs font-medium text-steel-300 transition-colors hover:bg-steel-800 hover:text-steel-100"
          >
            Çıkış
          </button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
