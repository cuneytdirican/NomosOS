import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES } from "@nomosos/shared";

/**
 * FAZ 7C — toplu görev işlemi. Her görev TEK TEK mevcut servis yolundan geçer
 * (durum makinesi, rol kapıları, denetim izi); toplu uç yalnız döngüdür.
 * Kısmi başarı DÜRÜSTÇE raporlanır: `failed[]` gerekçeli.
 */
export const bulkTaskSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    action: z.enum(["STATUS", "ASSIGN", "PRIORITY", "DUE"]),
    status: z.enum(TASK_STATUSES).optional(),
    note: z.string().trim().max(2000).optional(),
    assigneeId: z.string().uuid().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "STATUS" && !v.status) ctx.addIssue({ code: "custom", message: "Durum seçilmelidir.", path: ["status"] });
    if (v.action === "ASSIGN" && !v.assigneeId) ctx.addIssue({ code: "custom", message: "Sorumlu seçilmelidir.", path: ["assigneeId"] });
    if (v.action === "PRIORITY" && !v.priority) ctx.addIssue({ code: "custom", message: "Öncelik seçilmelidir.", path: ["priority"] });
    if (v.action === "DUE" && v.dueDate === undefined) ctx.addIssue({ code: "custom", message: "Son tarih verilmelidir (null = kaldır).", path: ["dueDate"] });
  });
export type BulkTaskInput = z.infer<typeof bulkTaskSchema>;
