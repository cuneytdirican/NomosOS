"use client";

/**
 * Dört-göz (two-person rule) göstergeleri.
 * Spec §Roller: talep eden ≠ onaylayan; bekleyen işlem PlatformApprovalRequest olarak
 * BEKLIYOR durumunda durur ve 72 saatte zaman aşımına düşer.
 */

import { Badge } from "./ui";
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUS_TONES,
  APPROVAL_TIMEOUT_HOURS,
  labelOf,
  remainingLabel,
  toneOf,
} from "@/lib/labels";
import { ACTION_LABELS, needsFourEyes, type AdminAction } from "@/lib/rbac";
import { useRole } from "./RoleGate";

/** İşlem bu rol için dört-göz gerektiriyorsa küçük rozet. */
export function ApprovalBadge({
  action,
  force = false,
}: {
  action: AdminAction;
  /** Rolden bağımsız olarak göstermek için (ör. onay kuyruğu satırları). */
  force?: boolean;
}) {
  const role = useRole();
  // denetim bulgusu K-11: burada iki AYRI kaynak `||` ile birleştiriliyordu
  // (`requiresApproval` matrise, `isFourEyesAction` elle yazılmış listeye
  // bakıyordu) ve rozet, API'nin tutmadığı bir söz veriyordu. Artık tek kaynak
  // matristir ve karar tek fonksiyondan gelir.
  const needed = force || needsFourEyes(role, action);
  if (!needed) return null;
  return (
    <Badge tone="yellow" title="Talep eden ≠ onaylayan — ikinci bir yetkilinin onayı gerekir.">
      4️⃣ Dört-göz onayı
    </Badge>
  );
}

/** Bekleyen onay talebinin durumu (BEKLIYOR / ONAYLANDI / REDDEDILDI / ZAMAN_ASIMI). */
export function ApprovalStatusBadge({
  status,
  expiresAt,
}: {
  status: string;
  expiresAt?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={toneOf(APPROVAL_STATUS_TONES, status)}>
        {labelOf(APPROVAL_STATUS_LABELS, status)}
      </Badge>
      {status === "BEKLIYOR" && expiresAt && (
        <span className="text-[11px] text-steel-500">{remainingLabel(expiresAt)}</span>
      )}
    </span>
  );
}

/**
 * Modal içinde gösterilen uyarı kutusu:
 * "Bu işlem tek kişiyle tamamlanamaz."
 */
export function ApprovalNotice({
  action,
  extra,
}: {
  action: AdminAction;
  extra?: string;
}) {
  const role = useRole();
  const needed = needsFourEyes(role, action); // denetim bulgusu K-11
  if (!needed) return null;
  return (
    <div className="rounded-lg border border-amber-800 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
      <p className="font-semibold text-amber-100">Dört-göz onayı gerektiren işlem</p>
      <p className="mt-1">
        <span className="text-amber-100">{ACTION_LABELS[action]}</span> tek kişiyle tamamlanamaz.
        Talebiniz <strong>BEKLIYOR</strong> durumunda onay kuyruğuna düşer; kendi talebinizi
        onaylayamazsınız. Onaylanmayan talep {APPROVAL_TIMEOUT_HOURS} saat sonra zaman aşımına
        uğrar. Gerekçe alanı zorunludur ve PlatformAuditLog&apos;a yazılır.
      </p>
      {extra && <p className="mt-1 text-amber-200/90">{extra}</p>}
    </div>
  );
}

/** Kuyruk sayacı — üst çubukta bekleyen onay sayısını gösterir. */
export function PendingApprovalCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge tone="yellow" title="Bekleyen dört-göz onayı">
      {count} bekleyen onay
    </Badge>
  );
}
