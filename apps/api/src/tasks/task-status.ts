import { BadRequestException } from "@nestjs/common";
import type { TaskStatus } from "@nomosos/shared";

/**
 * Görev durum makinesi (Modül 07 — kural 1).
 * ACIK → DEVAM_EDIYOR → (KONTROLDE → ONAY_BEKLIYOR →) TAMAMLANDI
 * KONTROLDE/ONAY_BEKLIYOR → DEVAM_EDIYOR geri gönderme sayılır ve gerekçe ister.
 */
export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  ACIK: ["DEVAM_EDIYOR", "IPTAL"],
  DEVAM_EDIYOR: ["KONTROLDE", "ONAY_BEKLIYOR", "TAMAMLANDI", "ACIK", "IPTAL"],
  KONTROLDE: ["ONAY_BEKLIYOR", "TAMAMLANDI", "DEVAM_EDIYOR", "IPTAL"],
  ONAY_BEKLIYOR: ["TAMAMLANDI", "DEVAM_EDIYOR", "IPTAL"],
  TAMAMLANDI: ["DEVAM_EDIYOR"],
  IPTAL: [],
};

/** Geri gönderme (ret) sayılan geçişler — gerekçe zorunludur. */
export const REJECTION_TRANSITIONS: Array<{ from: TaskStatus; to: TaskStatus }> = [
  { from: "KONTROLDE", to: "DEVAM_EDIYOR" },
  { from: "ONAY_BEKLIYOR", to: "DEVAM_EDIYOR" },
];

/** Onay yetkisi gerektiren geçiş. */
export function isApprovalTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === "ONAY_BEKLIYOR" && to === "TAMAMLANDI";
}

export function isRejectionTransition(from: TaskStatus, to: TaskStatus): boolean {
  return REJECTION_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function assertTaskStatusTransition(taskTitle: string, from: TaskStatus, to: TaskStatus): void {
  if (from === to) {
    throw new BadRequestException(`«${taskTitle}» görevi zaten ${to} durumunda.`);
  }
  const allowed = TASK_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    const allowedText = allowed.length > 0 ? allowed.join(", ") : "yok";
    throw new BadRequestException(
      `«${taskTitle}» görevi ${from} durumundan ${to} durumuna geçirilemez. İzinli geçişler: ${allowedText}.`
    );
  }
}
