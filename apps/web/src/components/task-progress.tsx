"use client";

/** Görev iş akışı göstergesi: AÇIK → DEVAM EDİYOR → KONTROLDE → ONAY BEKLİYOR → TAMAMLANDI */

import { TASK_STATUS_LABELS, TASK_WORKFLOW, labelOf } from "@/lib/labels";

export function TaskProgress({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  if (status === "IPTAL") {
    return (
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        İptal edildi — iş akışı durduruldu
      </p>
    );
  }

  const idx = TASK_WORKFLOW.indexOf(status as (typeof TASK_WORKFLOW)[number]);

  if (compact) {
    return (
      <div className="flex items-center gap-1" aria-label={`İş akışı: ${labelOf(TASK_STATUS_LABELS, status)}`}>
        {TASK_WORKFLOW.map((s, i) => (
          <span
            key={s}
            title={labelOf(TASK_STATUS_LABELS, s)}
            className={`h-1.5 w-6 rounded-full ${
              i <= idx ? (i === TASK_WORKFLOW.length - 1 ? "bg-emerald-500" : "bg-amber-500") : "bg-slate-200"
            }`}
          />
        ))}
      </div>
    );
  }

  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {TASK_WORKFLOW.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={s} className="flex items-center gap-1">
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                current
                  ? "bg-slate-900 text-amber-400"
                  : done
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                  current
                    ? "bg-amber-400 text-slate-900"
                    : done
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-300 text-white"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {labelOf(TASK_STATUS_LABELS, s)}
            </span>
            {i < TASK_WORKFLOW.length - 1 && (
              <span className={`h-px w-3 ${done ? "bg-emerald-400" : "bg-slate-200"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
