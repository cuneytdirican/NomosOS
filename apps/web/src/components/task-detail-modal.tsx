"use client";

/**
 * Görev detay modalı — workflow geçişi + durum geçmişi (TaskStatusLog).
 *
 * GET   /tasks/:id         — detay (statusLogs dahil)
 * PATCH /tasks/:id/status  — durum geçişi (log yazar)
 * PATCH /tasks/:id         — genel güncelleme (öncelik / son tarih)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api";
import type { Task } from "@/lib/types";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
} from "@/components/ui";
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_TONES,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONES,
  fmtDate,
  fmtDateTime,
  labelOf,
  toIsoDate,
} from "@/lib/labels";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@nomosos/shared";
import { TaskProgress } from "@/components/task-progress";

export function TaskDetailModal({
  open,
  taskId,
  fallback,
  onClose,
  onChanged,
}: {
  open: boolean;
  taskId: string | null;
  /** Listeden gelen kayıt — detay yüklenene kadar gösterilir. */
  fallback?: Task | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<Task | null>(fallback ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nextStatus, setNextStatus] = useState<TaskStatus>("DEVAM_EDIYOR");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<Task>(`/tasks/${taskId}`);
      setTask(data);
      setNextStatus(data.status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Görev detayı yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (!open || !taskId) return;
    setTask(fallback ?? null);
    setNote("");
    setActionError(null);
    void load();
    // fallback kasıtlı olarak bağımlılık dışı — her açılışta tek yükleme yeter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId, load]);

  async function changeStatus() {
    if (!task) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/tasks/${task.id}/status`, {
        method: "PATCH",
        body: { status: nextStatus, note: note.trim() || undefined },
      });
      setNote("");
      await load();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Durum güncellenemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function patchTask(body: Record<string, unknown>) {
    if (!task) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body });
      await load();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Görev güncellenemedi.");
    } finally {
      setBusy(false);
    }
  }

  const logs = task?.statusLogs ?? [];

  return (
    <Modal open={open} title="Görev Detayı" onClose={onClose} wide>
      {loading && !task ? (
        <Spinner label="Görev yükleniyor…" />
      ) : error && !task ? (
        <ErrorBox message={error} />
      ) : !task ? (
        <p className="text-sm text-slate-500">Görev bulunamadı.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-semibold text-slate-900">{task.title}</h4>
              <Badge tone={TASK_STATUS_TONES[task.status] ?? "gray"}>
                {labelOf(TASK_STATUS_LABELS, task.status)}
              </Badge>
              {task.priority && (
                <Badge tone={TASK_PRIORITY_TONES[task.priority] ?? "gray"}>
                  {labelOf(TASK_PRIORITY_LABELS, task.priority)}
                </Badge>
              )}
            </div>
            {task.description && (
              <p className="mt-2 text-sm leading-6 text-slate-600">{task.description}</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Sorumlu: {task.assignee?.fullName ?? "—"}
              {task.reviewer?.fullName ? ` · Kontrol: ${task.reviewer.fullName}` : ""}
              {task.dueDate ? ` · Son tarih: ${fmtDate(task.dueDate)}` : ""}
            </p>
            {task.case && (
              <p className="mt-1 text-xs">
                <Link
                  href={`/app/dosyalar/${task.case.id}`}
                  className="font-medium text-amber-600 hover:text-amber-500"
                >
                  Dosyaya git: {task.case.title} →
                </Link>
              </p>
            )}
          </div>

          <TaskProgress status={task.status} />

          {/* Durum geçişi */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-900">Durum geçişi</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Yeni durum">
                <Select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as TaskStatus)}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {labelOf(TASK_STATUS_LABELS, s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Geçiş notu" hint="Denetim izine yazılır.">
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Örn. Dilekçe taslağı kontrole verildi."
                />
              </Field>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                disabled={busy || nextStatus === task.status}
                onClick={() => void changeStatus()}
              >
                {busy ? "İşleniyor…" : "Durumu Güncelle"}
              </Button>
            </div>
          </div>

          {/* Hızlı düzenleme */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Öncelik">
              <Select
                value={task.priority ?? "NORMAL"}
                disabled={busy}
                onChange={(e) => void patchTask({ priority: e.target.value as TaskPriority })}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {labelOf(TASK_PRIORITY_LABELS, p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Son tarih">
              <Input
                type="date"
                value={task.dueDate ? toIsoDate(new Date(task.dueDate)) : ""}
                disabled={busy}
                onChange={(e) =>
                  void patchTask({
                    dueDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
              />
            </Field>
          </div>

          {actionError && <ErrorBox message={actionError} />}

          {/* Durum geçmişi */}
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">Durum geçmişi</p>
            {logs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-xs text-slate-500">
                Henüz durum geçişi kaydı yok.
              </p>
            ) : (
              <ol className="relative space-y-3 border-l border-slate-200 pl-5">
                {logs.map((log) => (
                  <li key={log.id} className="relative">
                    <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-900" />
                    <p className="text-xs text-slate-500">{fmtDateTime(log.createdAt)}</p>
                    <p className="text-sm text-slate-900">
                      {log.fromStatus
                        ? `${labelOf(TASK_STATUS_LABELS, log.fromStatus)} → `
                        : "Oluşturuldu → "}
                      <strong>{labelOf(TASK_STATUS_LABELS, log.toStatus)}</strong>
                    </p>
                    <p className="text-xs text-slate-500">
                      {log.user?.fullName ?? "—"}
                      {log.note ? ` · ${log.note}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Kapat
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
