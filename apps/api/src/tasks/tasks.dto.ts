import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES } from "@nomosos/shared";
import { nullableDate, nullableText, nullableUuid } from "../common/zod";

/** PATCH /tasks/:id — genel güncelleme (durum hariç). */
export const updateTaskSchema = z
  .object({
    title: z.string().min(3, "Görev başlığı en az 3 karakter olmalıdır.").max(300, "Görev başlığı en fazla 300 karakter olabilir.").optional(),
    description: nullableText(5000, "Açıklama"),
    assigneeId: z.string().uuid("Sorumlu geçerli bir kullanıcı olmalıdır.").optional(),
    reviewerId: nullableUuid("Kontrol eden"),
    caseId: nullableUuid("Dosya"),
    dueDate: nullableDate("Son tarih"),
    priority: z.enum(TASK_PRIORITIES, { errorMap: () => ({ message: "Geçersiz öncelik." }) }).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/** PATCH /tasks/:id/status — durum makinesi geçişi. */
export const updateTaskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES, { errorMap: () => ({ message: "Geçersiz görev durumu." }) }),
  note: z.string().max(2000, "Not en fazla 2000 karakter olabilir.").optional(),
});
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
