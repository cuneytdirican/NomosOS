/**
 * Kredi modülünün Zod şemaları — modül klasöründe YEREL tanımlıdır
 * (ortak karar 4). Krediler TAM SAYIDIR; para `Prisma.Decimal` ile taşınır ve
 * bu şemalarda string olarak alınır (float'a hiç dönüşmez).
 */

import { z } from "zod";

export const estimateCreditsSchema = z.object({
  taskType: z.string().min(2).max(64),
  caseId: z.string().uuid().optional(),
  /** İstemci ölçtüyse metnin karakter uzunluğu (sunucu yine kendi ölçümünü ekler). */
  contextChars: z.number().int().min(0).max(50_000_000).optional(),
});
export type EstimateCreditsInput = z.infer<typeof estimateCreditsSchema>;

export const purchaseCreditsSchema = z.object({
  packageKey: z.string().min(2).max(64),
});
export type PurchaseCreditsInput = z.infer<typeof purchaseCreditsSchema>;

export const autoTopUpSchema = z.object({
  /** null → otomatik yükleme KAPALI (varsayılan). */
  packageKey: z.string().min(2).max(64).nullable(),
  /**
   * Açık kullanıcı onayı (iş kuralı 12). Açarken zorunludur: otomatik yükleme
   * para harcayan bir ayardır, "yanlışlıkla açık kaldı" denemesin.
   */
  onay: z.boolean().optional(),
});
export type AutoTopUpInput = z.infer<typeof autoTopUpSchema>;

/*
 * `renewPeriodSchema` KALDIRILDI: dönem yenilemenin kiracıya açık bir HTTP ucu
 * yoktur (bkz. credits.controller.ts). `force` alanı, kotası biten bir büronun
 * dönemi bitmeden kotasını sıfırlayıp yeniden tahsis etmesine — yani kredi
 * basmasına — izin veriyordu. Platform tarafındaki yenileme
 * `adminAdjustCreditsSchema.renewPeriod` alanıyla, dört-göz onayıyla yapılır.
 */

// ---------------------------------------------------------------------------
// Platform tarafı
// ---------------------------------------------------------------------------

export const adminAdjustCreditsSchema = z
  .object({
    /** Cüzdana eklenecek/çıkarılacak kredi (negatif olabilir). */
    deltaCredits: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    /** Dahil kotayı yeniden belirle (Enterprise sözleşmeleri için). */
    includedCredits: z.number().int().min(0).max(10_000_000).optional(),
    documentQuota: z.number().int().min(0).max(10_000_000).optional(),
    /** BYO-LLM muafiyeti aç/kapat — kredi kapısı tamamen devre dışı kalır. */
    byoLlm: z.boolean().optional(),
    /** Dönemi yenile (dahil kota sıfırlanır, satın alınan korunur). */
    renewPeriod: z.boolean().optional(),
    reason: z.string().min(10).max(1000),
  })
  .refine(
    (v) =>
      v.deltaCredits !== undefined ||
      v.includedCredits !== undefined ||
      v.documentQuota !== undefined ||
      v.byoLlm !== undefined ||
      v.renewPeriod === true,
    { message: "En az bir değişiklik alanı gönderilmelidir." },
  );
export type AdminAdjustCreditsInput = z.infer<typeof adminAdjustCreditsSchema>;

export const adminUpdateTaskCostSchema = z.object({
  taskType: z.string().min(2).max(64),
  credits: z.number().int().min(0).max(1000),
  isFree: z.boolean(),
  description: z.string().max(500).optional(),
});
export type AdminUpdateTaskCostInput = z.infer<typeof adminUpdateTaskCostSchema>;

export const adminUpsertModelPriceSchema = z.object({
  providerType: z.enum(["ANTHROPIC", "OPENAI_COMPAT", "OLLAMA", "GEMINI", "CUSTOM"]),
  model: z.string().min(1).max(120),
  /** Para: string olarak alınır, Decimal'e çevrilir. Float'a HİÇ dönüşmez. */
  inputPricePer1M: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, "Fiyat en fazla 4 ondalık haneli olmalı."),
  outputPricePer1M: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, "Fiyat en fazla 4 ondalık haneli olmalı."),
  currency: z.string().min(3).max(3).optional(),
  /**
   * Yürürlük tarihi. Fiyat değişikliği GERİYE DÖNÜK UYGULANMAZ (iş kuralı 10):
   * eski satır silinmez, yeni bir `effectiveFrom` satırı eklenir.
   */
  effectiveFrom: z.string().datetime().optional(),
});
export type AdminUpsertModelPriceInput = z.infer<typeof adminUpsertModelPriceSchema>;
