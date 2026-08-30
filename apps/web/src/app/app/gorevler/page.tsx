"use client";

/**
 * Görevler — workflow görünümü.
 *
 * GET   /tasks?status=      — liste
 * GET   /tasks/:id          — detay (TaskStatusLog dahil, modalda)
 * PATCH /tasks/:id/status   — durum geçişi (log yazar)
 * PATCH /tasks/:id          — genel güncelleme (modalda)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList } from "@/lib/api";
import type { Task } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner, StatCard } from "@/components/ui";
import { TaskDetailModal } from "@/components/task-detail-modal";
import { TaskProgress } from "@/components/task-progress";
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_TONES,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONES,
  TASK_WORKFLOW,
  daysUntil,
  fmtDate,
  labelOf,
  urgencyTone,
} from "@/lib/labels";
import { TASK_STATUSES, type TaskStatus } from "@nomosos/shared";

/** İş akışında bir sonraki adım — hızlı ilerlet düğmesi için. */
function nextStatus(status: string): TaskStatus | null {
  const idx = TASK_WORKFLOW.indexOf(status as (typeof TASK_WORKFLOW)[number]);
  if (idx < 0 || idx >= TASK_WORKFLOW.length - 1) return null;
  return TASK_WORKFLOW[idx + 1] as TaskStatus;
}

export default function GorevlerPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openTaskFallback, setOpenTaskFallback] = useState<Task | null>(null);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>("/tasks", {
        query: { status: status || undefined, limit: "200" },
      });
      setTasks(asList<Task>(data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Görevler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function advance(task: Task, status: TaskStatus) {
    setUpdatingId(task.id);
    setUpdateError(null);
    const previous = task.status;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    try {
      await api(`/tasks/${task.id}/status`, { method: "PATCH", body: { status } });
      await load(filter);
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: previous } : t)));
      setUpdateError(err instanceof ApiError ? err.message : "Görev durumu güncellenemedi.");
    } finally {
      setUpdatingId(null);
    }
  }

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of tasks) map[t.status] = (map[t.status] ?? 0) + 1;
    return map;
  }, [tasks]);

  const overdue = useMemo(
    () =>
      tasks.filter(
        (t) => t.dueDate && t.status !== "TAMAMLANDI" && t.status !== "IPTAL" && daysUntil(t.dueDate) < 0,
      ).length,
    [tasks],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Görevler</h1>
        <p className="mt-1 text-sm text-slate-500">
          Dosya → görev → sorumlu → kontrol → onay zinciri. Her durum geçişi denetim kaydına yazılır.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Listelenen" value={tasks.length} tone="navy" />
        <StatCard label="Devam Ediyor" value={counts.DEVAM_EDIYOR ?? 0} tone="slate" />
        <StatCard label="Onay Bekliyor" value={counts.ONAY_BEKLIYOR ?? 0} tone="gold" />
        <StatCard
          label="Süresi Geçmiş"
          value={overdue}
          tone={overdue > 0 ? "red" : "slate"}
          hint="Son tarihi geçen açık görev"
        />
      </div>

      {/* Durum filtresi — sekme şeridi */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === ""} onClick={() => setFilter("")} label="Tümü" />
        {TASK_STATUSES.map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            onClick={() => setFilter(s)}
            label={labelOf(TASK_STATUS_LABELS, s)}
          />
        ))}
      </div>

      {updateError && <ErrorBox message={updateError} />}

      <Card>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} />
        ) : tasks.length === 0 ? (
          <EmptyState message="Bu filtrede görev bulunmuyor." />
        ) : (
          <ul className="space-y-3">
            {tasks.map((t) => {
              const next = nextStatus(t.status);
              const dueDays = t.dueDate ? daysUntil(t.dueDate) : null;
              return (
                <li key={t.id} className="rounded-lg border border-slate-200 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenTaskFallback(t);
                          setOpenTaskId(t.id);
                        }}
                        className="text-left text-sm font-semibold text-slate-900 hover:text-amber-600"
                      >
                        {t.title}
                      </button>
                      {t.description && (
                        <p className="mt-0.5 max-w-2xl text-xs text-slate-500">{t.description}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        Sorumlu: <strong className="text-slate-700">{t.assignee?.fullName ?? "—"}</strong>
                        {t.reviewer?.fullName ? ` · Kontrol: ${t.reviewer.fullName}` : ""}
                        {t.case ? (
                          <>
                            {" · "}
                            <Link
                              href={`/app/dosyalar/${t.case.id}`}
                              className="hover:text-amber-600"
                            >
                              {t.case.title}
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {t.priority && (
                        <Badge tone={TASK_PRIORITY_TONES[t.priority] ?? "gray"}>
                          {labelOf(TASK_PRIORITY_LABELS, t.priority)}
                        </Badge>
                      )}
                      {t.dueDate && dueDays !== null && (
                        <Badge
                          tone={
                            t.status === "TAMAMLANDI" || t.status === "IPTAL"
                              ? "gray"
                              : urgencyTone(dueDays)
                          }
                        >
                          {fmtDate(t.dueDate)}
                        </Badge>
                      )}
                      <Badge tone={TASK_STATUS_TONES[t.status] ?? "gray"}>
                        {labelOf(TASK_STATUS_LABELS, t.status)}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <TaskProgress status={t.status} />
                    <div className="flex gap-2">
                      {next && (
                        <Button
                          size="sm"
                          disabled={updatingId === t.id}
                          onClick={() => void advance(t, next)}
                        >
                          {labelOf(TASK_STATUS_LABELS, next)} →
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setOpenTaskFallback(t);
                          setOpenTaskId(t.id);
                        }}
                      >
                        Detay
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <TaskDetailModal
        open={openTaskId !== null}
        taskId={openTaskId}
        fallback={openTaskFallback}
        onClose={() => {
          setOpenTaskId(null);
          setOpenTaskFallback(null);
        }}
        onChanged={() => void load(filter)}
      />
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-slate-900 text-amber-400"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}
