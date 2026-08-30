"use client";

/**
 * Yetki kapısı — yetkisiz kullanıcıya düğmeyi hiç render etmez.
 * UI'daki gizleme yalnız ergonomidir; asıl yaptırım API katmanındadır
 * (ANALYST_READONLY için tüm mutasyon uçları 403 döner).
 */

import type { ReactNode } from "react";
import { useAdminSession } from "@/lib/session";
import {
  ACTION_LABELS,
  can,
  canMutate,
  isMasked,
  isReadOnly,
  levelOf,
  requiresApproval,
  type AdminAction,
  type AdminRole,
} from "@/lib/rbac";
import { ROLE_LABELS } from "@/lib/labels";
import { Card } from "./ui";

/** Oturumdaki rol için yetki sorgulama kancaları. */
export function useRole(): AdminRole | null {
  return useAdminSession().role;
}

export function useCan(action: AdminAction): boolean {
  return can(useRole(), action);
}

export function useCanMutate(action: AdminAction): boolean {
  return canMutate(useRole(), action);
}

export function useNeedsApproval(action: AdminAction): boolean {
  return requiresApproval(useRole(), action);
}

export function useMasked(action: AdminAction): boolean {
  return isMasked(useRole(), action);
}

export function useIsReadOnly(action: AdminAction): boolean {
  return isReadOnly(useRole(), action);
}

/**
 * Görünürlük kapısı.
 * - mode="hide" (varsayılan): yetki yoksa hiçbir şey render edilmez.
 * - mode="notice": yetki yoksa "yetkiniz yok" satırı gösterilir.
 * - mutation: true → salt-okur roller de göremez (yalnız full/four_eyes geçer).
 */
export function RoleGate({
  action,
  children,
  mode = "hide",
  mutation = false,
  fallback,
}: {
  action: AdminAction;
  children: ReactNode;
  mode?: "hide" | "notice";
  mutation?: boolean;
  fallback?: ReactNode;
}) {
  const role = useRole();
  const allowed = mutation ? canMutate(role, action) : can(role, action);

  if (allowed) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  if (mode === "notice") return <NoAccessInline action={action} role={role} />;
  return null;
}

/** Küçük "yetkiniz yok" satırı — düğmenin yerine geçebilir. */
export function NoAccessInline({
  action,
  role,
}: {
  action: AdminAction;
  role?: AdminRole | null;
}) {
  const sessionRole = useAdminSession().role;
  const effective = role !== undefined ? role : sessionRole;
  return (
    <p className="inline-flex items-center gap-1.5 rounded-md border border-steel-700 bg-steel-800/50 px-2.5 py-1.5 text-xs text-steel-400">
      <LockIcon />
      Yetkiniz yok — <span className="text-steel-300">{ACTION_LABELS[action]}</span>
      {effective && <span className="text-steel-500">({ROLE_LABELS[effective]})</span>}
    </p>
  );
}

/**
 * Sayfa düzeyi kapı — yetkisiz role tam sayfa "yetkiniz yok" durumu gösterir.
 * Not: ANALYST_READONLY için bu ekranların çoğu kapalıdır (yalnız Kurul Raporu açıktır).
 */
export function PageGate({
  action,
  children,
  hint,
}: {
  action: AdminAction;
  children: ReactNode;
  hint?: string;
}) {
  const { role, ready } = useAdminSession();
  if (!ready) return null;
  if (can(role, action)) return <>{children}</>;

  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="rounded-full border border-steel-700 bg-steel-800 p-3 text-steel-400">
          <LockIcon large />
        </div>
        <h2 className="text-base font-semibold text-steel-100">Bu sayfaya erişim yetkiniz yok</h2>
        <p className="max-w-md text-sm text-steel-400">
          <span className="text-steel-200">{ACTION_LABELS[action]}</span> işlemi{" "}
          <span className="text-steel-200">{role ? ROLE_LABELS[role] : "tanımsız rol"}</span> rolüne
          kapalıdır. Yetki matrisi tek kaynaktan tanımlanır ve API katmanı aynı kararı verir (403).
        </p>
        {hint && <p className="max-w-md text-xs text-steel-500">{hint}</p>}
      </div>
    </Card>
  );
}

/** Rolün bu işlemdeki seviyesini rozet olarak gösterir (matris ekranı ve başlıklar için). */
export function LevelHint({ action }: { action: AdminAction }) {
  const role = useRole();
  const lvl = levelOf(role, action);
  if (lvl === "full" || lvl === "none") return null;
  const text =
    lvl === "read"
      ? "Salt-okur görünüm"
      : lvl === "masked"
        ? "Maskeli / toplulaştırılmış görünüm"
        : "Dört-göz onayı gerekir";
  return (
    <span className="rounded-full border border-steel-700 bg-steel-800/60 px-2 py-0.5 text-[11px] text-steel-300">
      {text}
    </span>
  );
}

function LockIcon({ large = false }: { large?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={large ? "h-6 w-6" : "h-3.5 w-3.5"}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
