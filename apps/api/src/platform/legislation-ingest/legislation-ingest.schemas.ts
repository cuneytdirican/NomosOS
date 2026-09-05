import { z } from "zod";

export const ingestItemsQuerySchema = z.object({
  status: z.enum(["BEKLIYOR", "ONAYLANDI", "REDDEDILDI"]).optional(),
  sourceKey: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type IngestItemsQueryInput = z.infer<typeof ingestItemsQuerySchema>;

export const ingestRejectSchema = z.object({
  reason: z.string().trim().min(3, "Red gerekçesi en az 3 karakter olmalıdır.").max(1000),
});
export type IngestRejectInput = z.infer<typeof ingestRejectSchema>;
