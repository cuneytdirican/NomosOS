"use client";

/**
 * Görevler sayfası — kontrol/onay kuyruğu + iş yükü kartları (Faz 7C).
 * Kuyruk: KONTROLDE (kontrolcüsü ben) ve ONAY_BEKLIYOR (onay yetkim varsa). İş yükü yalnız HUKUKI rol.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api";
import { fetchReviewQueue, fetchWorkload, type WorkloadRow } from "@/lib/faz7-is-akisi";
import type { Task } from "@/lib/types";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { TASK_STATUS_LABELS, fmtDate, labelOf } from "@/lib/labels";

export function ReviewQueueCard({ onChanged, notify }: { onChanged: () => void; notify: (m: string, tone?: "error") => void }) {
  const [items, setItems] = useState<Task[] | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchReviewQueue();
      setItems(res.items);
      setCanApprove(res.canApprove);
    } catch {
      setItems(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(t: Task, status: "TAMAMLANDI" | "DEVAM_EDIYOR" | "ONAY_BEKLIYOR") {
    let note: string | undefined;
    if (status === "DEVAM_EDIYOR") {
      note = window.prompt("Geri gönderme gerekçesi (zorunlu):") ?? "";
      if (!note.trim()) return;
    }
    setBusyId(t.id);
    try {
      await api(`/tasks/${t.id}/status`, { method: "PATCH", body: { status, ...(note ? { note } : {}) } });
      notify(status === "DEVAM_EDIYOR" ? "Görev geri gönderildi." : status === "TAMAMLANDI" ? "Görev onaylandı ve tamamlandı." : "Görev onaya iletildi.");
      await load();
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "İşlem yapılamadı.", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (items === null) return null;
  return (
    <Card title={`Kontrol / Onay Kuyruğu (${items.length})`}>
      {items.length === 0 ? (
        <EmptyState message="Kontrolünüzü ya da onayınızı bekleyen görev yok." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5" data-testid="kuyruk-satiri">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900">{t.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <Badge tone={t.status === "ONAY_BEKLIYOR" ? "gold" : "blue"}>{labelOf(TASK_STATUS_LABELS, t.status)}</Badge>
                  {t.assignee?.fullName ? ` · Sorumlu: ${t.assignee.fullName}` : ""}
                  {t.dueDate ? ` · ${fmtDate(t.dueDate)}` : ""}
                  {t.case ? (
                    <>
                      {" · "}
                      <Link href={`/app/dosyalar/${t.case.id}`} className="hover:text-amber-600">
                        {t.case.fileNumber ?? t.case.title}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {t.status === "KONTROLDE" && (
                  <Button size="sm" variant="secondary" disabled={busyId === t.id} onClick={() => void decide(t, "ONAY_BEKLIYOR")}>
                    Onaya ilet
                  </Button>
                )}
                {(t.status === "ONAY_BEKLIYOR" ? canApprove : true) && (
                  <Button size="sm" variant="gold" disabled={busyId === t.id} onClick={() => void decide(t, "TAMAMLANDI")}>
                    {t.status === "ONAY_BEKLIYOR" ? "Onayla" : "Tamamla"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busyId === t.id} onClick={() => void decide(t, "DEVAM_EDIYOR")}>
                  Geri gönder
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function WorkloadCard() {
  const [rows, setRows] = useState<WorkloadRow[] | null>(null);
  const [totals, setTotals] = useState({ open: 0, overdue: 0 });

  useEffect(() => {
    fetchWorkload()
      .then((r) => {
        setRows(r.items);
        setTotals({ open: r.totalOpen, overdue: r.totalOverdue });
      })
      .catch(() => setRows(null));
  }, []);

  if (rows === null) return null;
  return (
    <Card title="İş Yükü" action={<span className="text-xs text-slate-500">{totals.open} açık · {totals.overdue} gecikmiş</span>}>
      {rows.length === 0 ? (
        <EmptyState message="Açık görev yok." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-3">Kişi</th>
                <th className="py-1.5 pr-3">Açık</th>
                <th className="py-1.5 pr-3">Gecikmiş</th>
                <th className="py-1.5 pr-3">Kritik</th>
                <th className="py-1.5 pr-3">Kontrolde</th>
                <th className="py-1.5 pr-3">Şablondan</th>
                <th className="py-1.5">En yakın son tarih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="py-2 pr-3 font-medium text-slate-900">{r.fullName}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.open}</td>
                  <td className={`py-2 pr-3 tabular-nums ${r.overdue > 0 ? "font-semibold text-red-700" : ""}`}>{r.overdue}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.critical}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.inReview}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.workflows}</td>
                  <td className="py-2 text-slate-600">{r.nextDue ? fmtDate(r.nextDue) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
