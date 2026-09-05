/**
 * Adaptör kaydı — ürün kodunun tek temas noktası.
 *
 * Servisler tek tek adaptör tanımaz; `searchAll` / `fetchByCitationAll` çağırır.
 * Yeni bir kaynak eklemek için: CaseLawSourceAdapter'ı uygulayan sınıfı yaz,
 * modülde provider olarak kaydet, buradaki listeye ekle. Başka hiçbir dosya
 * değişmez (Modül 23, kabul kriteri 10).
 */

import { Injectable, Logger } from "@nestjs/common";
import { LocalDbCaseLawAdapter } from "./local-db.adapter";
import { ManualEntryCaseLawAdapter } from "./manual-entry.adapter";
import { AymLiveAdapter } from "./aym-live.adapter";
import { UyusmazlikLiveAdapter } from "./uyusmazlik-live.adapter";
import type {
  CaseLawAdapterHealth,
  CaseLawCitationLookup,
  CaseLawCitationQuery,
  CaseLawFilters,
  CaseLawHit,
  CaseLawSourceAdapter,
} from "./types";

/** Künye aramasının tüm adaptörler üzerinden birleştirilmiş sonucu. */
export interface AggregatedCitationLookup {
  outcome: "FOUND" | "NOT_FOUND" | "SEARCH_FAILED";
  lookup?: CaseLawCitationLookup;
  /** Her adaptörün ayrı sonucu — denetim izi ve hata mesajı için. */
  perAdapter: CaseLawCitationLookup[];
}

@Injectable()
export class CaseLawAdapterRegistry {
  private readonly logger = new Logger(CaseLawAdapterRegistry.name);
  private readonly adapters: CaseLawSourceAdapter[];

  constructor(
    localDb: LocalDbCaseLawAdapter,
    manual: ManualEntryCaseLawAdapter,
    // AYM + Uyuşmazlık canlı adaptörleri: yalnız künye teyidi (canSearch kapalı —
    // karar metinleri bugün çekilemiyor; bkz. dosya başlıkları). DI ile gelir:
    // testte sahtelenebilir, modülde tek örnek. Sıra önemlidir — ilk FOUND kazanır;
    // yerel havuz ve elle giriş canlı kaynaklardan ÖNCE gelir.
    aym: AymLiveAdapter,
    uyusmazlik: UyusmazlikLiveAdapter,
  ) {
    this.adapters = [localDb, manual, aym, uyusmazlik];
  }

  list(): readonly CaseLawSourceAdapter[] {
    return this.adapters;
  }

  /**
   * Tüm arama yapabilen adaptörlerde arar ve sonuçları birleştirir.
   *
   * Aynı karar birden çok adaptörden gelebilir (elle girilen kayıt hem yerel
   * havuzda hem elle giriş adaptöründe görünür); künye anahtarıyla tekilleştirilir,
   * en yüksek skor korunur, eşleşen terimler birleştirilir.
   */
  async searchAll(query: string, filters: CaseLawFilters): Promise<CaseLawHit[]> {
    const results = await Promise.all(
      this.adapters
        .filter((a) => a.canSearch)
        .map(async (adapter) => {
          try {
            return await adapter.search(query, filters);
          } catch (err) {
            // Bir adaptörün düşmesi aramayı tümden başarısız yapmaz; eksik sonuç uyarısı
            // healthCheck ucundan görülür.
            this.logger.warn(`Adaptör aramada hata verdi (${adapter.key}): ${(err as Error).message}`);
            return [] as CaseLawHit[];
          }
        }),
    );

    const merged = new Map<string, CaseLawHit>();
    for (const hit of results.flat()) {
      const key = hit.caseLawId;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...hit, matchedTerms: [...hit.matchedTerms] });
        continue;
      }
      existing.score = Math.max(existing.score, hit.score);
      for (const term of hit.matchedTerms) {
        if (!existing.matchedTerms.includes(term)) existing.matchedTerms.push(term);
      }
    }

    const limit = Math.min(filters.limit ?? 20, 50);
    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Künyeyi tüm adaptörlerde arar. FAIL-CLOSED birleştirme:
   *  - Herhangi bir adaptör BULDU  → FOUND (kesin, belirsizlik notuyla).
   *  - Hiçbiri bulamadı, hepsi sağlıklı çalıştı → NOT_FOUND (atıf muhtemelen uydurma).
   *  - En az bir adaptör arama YAPAMADI ve bulan yok → SEARCH_FAILED (asla doğrulanmış sayılmaz).
   */
  async fetchByCitationAll(query: CaseLawCitationQuery): Promise<AggregatedCitationLookup> {
    // Adaptörler PARALEL sorgulanır (canlı kaynaklar 12 sn'ye kadar bekletebilir;
    // ardışık çağrı her atfı toplam süreye ekliyordu). Sonuç sırası adaptör
    // sırasıyla aynı kalır — "ilk FOUND kazanır" kuralı değişmez.
    const perAdapter: CaseLawCitationLookup[] = await Promise.all(
      this.adapters
        .filter((adapter) => adapter.canFetchByCitation)
        .map(async (adapter): Promise<CaseLawCitationLookup> => {
          try {
            return await adapter.fetchByCitation(query);
          } catch (err) {
            return {
              outcome: "SEARCH_FAILED",
              note: `Adaptör beklenmedik hata verdi: ${(err as Error).message}`,
              adapterKey: adapter.key,
            };
          }
        }),
    );

    const found = perAdapter.find((r) => r.outcome === "FOUND");
    if (found) return { outcome: "FOUND", lookup: found, perAdapter };

    const failed = perAdapter.find((r) => r.outcome === "SEARCH_FAILED");
    if (failed) return { outcome: "SEARCH_FAILED", lookup: failed, perAdapter };

    return {
      outcome: "NOT_FOUND",
      lookup: perAdapter[0],
      perAdapter,
    };
  }

  async healthCheckAll(): Promise<CaseLawAdapterHealth[]> {
    return Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          return await adapter.healthCheck();
        } catch (err) {
          return {
            key: adapter.key,
            name: adapter.name,
            healthy: false,
            message: `Sağlık kontrolü başarısız: ${(err as Error).message}`,
            checkedAt: new Date(),
            canSearch: adapter.canSearch,
            canFetchByCitation: adapter.canFetchByCitation,
          } satisfies CaseLawAdapterHealth;
        }
      }),
    );
  }
}
