/**
 * İÇ MALİYET HESABI — `ModelPrice` üzerinden gerçek sağlayıcı gideri.
 *
 *   maliyet = (girdiToken / 1M × girdiFiyat) + (çıktıToken / 1M × çıktıFiyat)
 *
 * KULLANICIYA GÖSTERİLMEZ (spec §İç muhasebe). Yalnızca `AiUsageLog.estimatedCost`
 * ve platform marj raporu bu değeri okur.
 *
 * İKİ DEMİR KURAL:
 *  1. PARA DECIMAL'DİR. `Prisma.Decimal` ile çarpılır/bölünür; hiçbir aşamada
 *     `Number` aritmetiğine düşülmez (ortak karar 5).
 *  2. FİYAT DEĞİŞİKLİĞİ GERİYE DÖNÜK UYGULANMAZ (iş kuralı 10): çağrının
 *     TARİHİNDE yürürlükte olan satır seçilir (`effectiveFrom <= at`, en yenisi).
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type AiProviderType } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";

export interface ResolvedCost {
  amount: Prisma.Decimal;
  currency: string;
  /** Fiyat satırı bulunamadıysa false — maliyet SIFIR SAYILMAZ, "bilinmiyor"dur. */
  priced: boolean;
  model: string;
  providerType: string;
}

const CACHE_TTL_MS = 5 * 60_000;
const MILLION = new Prisma.Decimal(1_000_000);

interface CachedPrice {
  at: number;
  row: { inputPricePer1M: Prisma.Decimal; outputPricePer1M: Prisma.Decimal; currency: string } | null;
}

@Injectable()
export class ModelPriceService {
  private readonly logger = new Logger(ModelPriceService.name);
  private readonly cache = new Map<string, CachedPrice>();

  constructor(private readonly prisma: PrismaService) {}

  /** Önbelleği düşürür — panelden fiyat güncellendiğinde çağrılır. */
  invalidate(): void {
    this.cache.clear();
  }

  private key(providerType: string, model: string, at: Date): string {
    // Gün bazında önbellek: aynı gün içindeki çağrılar aynı fiyat satırını görür.
    return `${providerType}|${model}|${at.toISOString().slice(0, 10)}`;
  }

  private async lookup(providerType: string, model: string, at: Date) {
    const key = this.key(providerType, model, at);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;

    let row: CachedPrice["row"] = null;
    try {
      const found = await this.prisma.client.modelPrice.findFirst({
        where: {
          providerType: providerType as AiProviderType,
          model,
          effectiveFrom: { lte: at },
        },
        orderBy: { effectiveFrom: "desc" },
        select: { inputPricePer1M: true, outputPricePer1M: true, currency: true },
      });
      row = found ?? null;
    } catch (err) {
      this.logger.warn(
        `Model fiyatı okunamadı (${providerType}/${model}): ${(err as Error).message}`,
      );
      return null; // Önbelleğe YAZMA — geçici hatayı 5 dakika kalıcı yapmayalım.
    }
    this.cache.set(key, { at: Date.now(), row });
    return row;
  }

  /**
   * Bir çağrının gerçek maliyeti.
   *
   * Token bilgisi dönmeyen sağlayıcılarda (OLLAMA/CUSTOM) `inputTokens`
   * `undefined` gelir: bu SIFIR DEĞİLDİR, BİLİNMEZDİR. O çağrı için
   * `priced=false` döner ve `AiUsageLog.estimatedCost` null bırakılır —
   * marj raporu "fiyatlanamayan çağrı" olarak ayrı sayar.
   */
  async costOf(input: {
    providerType: string;
    model: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    at?: Date;
  }): Promise<ResolvedCost> {
    const at = input.at ?? new Date();
    const base: Omit<ResolvedCost, "amount" | "priced" | "currency"> = {
      model: input.model,
      providerType: input.providerType,
    };

    if (input.inputTokens == null && input.outputTokens == null) {
      return { ...base, amount: new Prisma.Decimal(0), currency: "USD", priced: false };
    }

    const row = await this.lookup(input.providerType, input.model, at);
    if (!row) {
      return { ...base, amount: new Prisma.Decimal(0), currency: "USD", priced: false };
    }

    const inTok = new Prisma.Decimal(Math.max(0, input.inputTokens ?? 0));
    const outTok = new Prisma.Decimal(Math.max(0, input.outputTokens ?? 0));
    const amount = row.inputPricePer1M
      .mul(inTok)
      .div(MILLION)
      .add(row.outputPricePer1M.mul(outTok).div(MILLION));

    return {
      ...base,
      // Decimal(12,4) — dört haneden fazlası veritabanında zaten yuvarlanır.
      amount: amount.toDecimalPlaces(4),
      currency: row.currency,
      priced: true,
    };
  }
}
