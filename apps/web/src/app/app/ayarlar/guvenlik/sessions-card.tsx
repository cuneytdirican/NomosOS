"use client";

/**
 * Açık oturumlar kartı (Enterprise++ cihaz bazlı oturum listesi).
 * Kullanıcı hangi cihazlarda açık olduğunu görür; tek bir cihazı ya da bu
 * cihaz dışındaki tümünü kapatır. Bu cihazı kapatırsa girişe döner.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, clearToken } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner } from "@/components/ui";

export interface SessionRow {
  id: string;
  deviceLabel: string;
  ip: string | null;
  via: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export const VIA_LABELS: Record<string, string> = { parola: "Parola", "parola+2fa": "Parola + 2FA", sso: "Kurumsal giriş (SSO)" };
export const fmtDate = (v: string) => new Date(v).toLocaleString("tr-TR");

export function SessionsCard() {
  const router = useRouter();
  const [items, setItems] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: SessionRow[] }>("/auth/sessions");
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Oturumlar yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(s: SessionRow) {
    if (s.current && !window.confirm("Bu cihazdaki oturumunuz kapanacak ve giriş sayfasına döneceksiniz. Devam?")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/sessions/${s.id}`, { method: "DELETE" });
      if (s.current) {
        clearToken();
        router.replace("/giris");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Oturum kapatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    if (!window.confirm("Bu cihaz dışındaki tüm oturumlarınız kapatılacak. Devam?")) return;
    setBusy(true);
    setError(null);
    try {
      await api("/auth/sessions", { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Oturumlar kapatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Açık oturumlar"
      action={
        items && items.length > 1 ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void revokeOthers()}>
            Diğer cihazları kapat
          </Button>
        ) : undefined
      }
    >
      {error && <ErrorBox message={error} />}
      {items === null ? (
        <Spinner label="Oturumlar yükleniyor…" />
      ) : items.length === 0 ? (
        <EmptyState message="Kayıtlı açık oturum yok." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-900">{s.deviceLabel}</p>
                  {s.current && <Badge tone="green">Bu cihaz</Badge>}
                  <Badge tone="gray">{VIA_LABELS[s.via] ?? s.via}</Badge>
                </div>
                <p className="text-xs text-slate-500">
                  {s.ip ? `${s.ip} · ` : ""}giriş {fmtDate(s.createdAt)} · son etkinlik {fmtDate(s.lastSeenAt)} · bitiş {fmtDate(s.expiresAt)}
                </p>
              </div>
              <Button size="sm" variant={s.current ? "danger" : "secondary"} disabled={busy} onClick={() => void revoke(s)}>
                {s.current ? "Bu cihazdan çık" : "Kapat"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
