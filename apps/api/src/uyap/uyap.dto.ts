/**
 * UYAP Köprüsü giriş şemaları — apps/uyap-extension/src/types/dto.ts sözleşmesi.
 *
 * Bu şemalar eklentinin GÖNDERDİĞİ gövdelere karşılık gelir; alan adları birebir
 * korunmalıdır (camelCase) yoksa eklenti ayrıştırıcıdan geçse de sunucu reddeder.
 */

import { z } from "zod";

/** Eklentinin kendini tanıttığı üstveri. */
const clientInfoSchema = z.object({
  extensionVersion: z.string().trim().min(1).max(40),
  selectorVersion: z.string().trim().min(1).max(40),
  sourceHost: z.string().trim().min(1).max(200),
});

/** POST /uyap/pair */
export const pairSchema = z.object({
  pairingCode: z.string().trim().min(6).max(20),
  deviceName: z.string().trim().min(1).max(120),
  extensionVersion: z.string().trim().min(1).max(40),
});
export type PairInput = z.infer<typeof pairSchema>;

/** POST /uyap/pair/refresh */
export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(10).max(200),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

/** POST /uyap/sync/files */
const tarafSchema = z.object({
  rol: z.string().max(100),
  ad: z.string().max(300),
  vekil: z.string().max(300).nullable(),
  sira: z.number().int().nullable(),
});

export const syncFilesSchema = z.object({
  client: clientInfoSchema,
  files: z
    .array(
      z.object({
        uyapDosyaNo: z.string().trim().min(1).max(60),
        uyapDosyaId: z.string().max(100).nullable(),
        birim: z.string().max(200),
        dosyaTuru: z.string().max(120).nullable(),
        durum: z.string().max(120).nullable(),
        acilisTarihi: z.string().max(40).nullable(),
        konu: z.string().max(2000).nullable(),
        taraflar: z.array(tarafSchema).max(60),
        detayUrl: z.string().max(500).nullable(),
        /** Faz 6: icra dosya ekranından okunan alanlar (eklenti ICRA_DOSYA ayrıştırıcısı). */
        icra: z
          .object({
            alacakTutari: z.string().max(40).nullable(),
            takipTuru: z.string().max(120).nullable(),
            takipTarihi: z.string().max(40).nullable(),
            borclu: z.string().max(300).nullable(),
            alacakli: z.string().max(300).nullable(),
            asama: z.string().max(120).nullable(),
          })
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(300),
  trigger: z.enum(["MANUAL", "SCHEDULED", "PAGE_ACTION"]),
});
export type SyncFilesInput = z.infer<typeof syncFilesSchema>;

/** POST /uyap/sync/events */
export const syncEventsSchema = z.object({
  client: clientInfoSchema,
  uyapDosyaNo: z.string().trim().min(1).max(60),
  events: z
    .array(
      z.object({
        externalHash: z.string().trim().min(16).max(128),
        tarih: z.string().trim().min(4).max(40),
        islem: z.string().trim().min(1).max(300),
        aciklama: z.string().max(2000).nullable(),
        birim: z.string().max(200).nullable(),
        sira: z.number().int().nullable(),
      }),
    )
    .min(1)
    .max(500),
  hearings: z
    .array(
      z.object({
        uyapDosyaNo: z.string().trim().min(1).max(60),
        externalHash: z.string().trim().min(16).max(128),
        tarih: z.string().trim().min(4).max(40),
        salon: z.string().max(200).nullable(),
        tur: z.string().max(200).nullable(),
        aciklama: z.string().max(2000).nullable(),
      }),
    )
    .max(200)
    .optional(),
  trigger: z.enum(["MANUAL", "SCHEDULED", "PAGE_ACTION"]),
});
export type SyncEventsInput = z.infer<typeof syncEventsSchema>;

/** POST /uyap/documents/presign */
export const presignSchema = z.object({
  client: clientInfoSchema,
  uyapDosyaNo: z.string().trim().min(1).max(60),
  uyapEvrakId: z.string().max(100).nullable(),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  contentHash: z.string().trim().length(64),
});
export type PresignInput = z.infer<typeof presignSchema>;

/** POST /uyap/documents/commit */
export const commitSchema = z.object({
  client: clientInfoSchema,
  storageKey: z.string().trim().min(5).max(500),
  uyapDosyaNo: z.string().trim().min(1).max(60),
  uyapEvrakId: z.string().max(100).nullable(),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  contentHash: z.string().trim().length(64),
  evrakTuru: z.string().max(200).nullable(),
  evrakTarihi: z.string().max(40).nullable(),
  gonderen: z.string().max(300).nullable(),
});
export type CommitInput = z.infer<typeof commitSchema>;

/** Web tarafı: eşleştirme kuyruğu çözümleme. */
export const resolveMatchSchema = z.object({
  caseId: z.string().uuid("Geçerli bir dosya kimliği seçin."),
});
export type ResolveMatchInput = z.infer<typeof resolveMatchSchema>;

/** Faz 6 — POST /uyap/match-queue/:id/create-case */
export const createCaseFromQueueSchema = z.object({
  clientId: z.string().uuid("Müvekkil seçilmelidir."),
  type: z.enum(["DAVA", "ICRA", "CEZA", "ARABULUCULUK", "DANISMANLIK"]).optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(300).nullable().optional(),
});
export type CreateCaseFromQueueInput = z.infer<typeof createCaseFromQueueSchema>;
