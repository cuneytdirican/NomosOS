/**
 * Modül 23 — İçtihat kaynağı adaptör sözleşmesi.
 *
 * MİMARİ KARAR (docs/moduller/23-ictihat-mevzuat.md): Türkiye'de içtihat için
 * resmî ve kararlı bir kamu API'si YOKTUR. Yargıtay/Danıştay/UYAP tarafında
 * üçüncü taraflara açık, sözleşmesi belli bir servis bulunmadığı için ürün kodu
 * hiçbir kaynağa doğrudan bağlanmaz; her kaynak bu arayüzü uygulayan bir
 * ADAPTÖR olarak takılır. Sağlayıcı değiştiğinde (lisanslı veri sağlayıcı, toplu
 * veri seti, ileride resmî servis) ürün kodu değişmez.
 *
 * !!! UYDURMA ENTEGRASYON YASAĞI: Bu depoda "Yargıtay API'si" adı altında sahte
 * bir HTTP istemcisi YOKTUR ve yazılmayacaktır. Var olan iki adaptör (LocalDb ve
 * ManualEntry) yalnızca KENDİ havuzumuzdaki, kaynağı belli kayıtlarla çalışır.
 * Gerçek bir dış kaynak eklenecekse yeni bir dosyada bu arayüz uygulanır ve
 * `CaseLawAdapterRegistry`'ye eklenir.
 */

import type { CaseLawDocument } from "@nomosos/db";

/** Aramada uygulanabilen deterministik süzgeçler. */
export interface CaseLawFilters {
  /**
   * ÇAĞIRAN KİRACI — görünürlük süzgecinin dayanağı (ZORUNLU).
   *
   * Havuz "kamusal veri" olduğu için PAYLAŞIMLIDIR, ama elle girilen kayıtlar
   * kamusal değildir: avukatın girdiği özet/ilgi notu çoğu zaman kendi
   * dosyasından cümleler taşır. Bu yüzden `createdByTenantId` dolu kayıtlar
   * yalnızca sahibine görünür; seed/resmî kayıtlar (null) herkese açıktır.
   */
  tenantId: string;
  /** Mahkeme adında geçen metin, örn. "Yargıtay" veya "9. Hukuk". */
  court?: string;
  /** Karar tarihi alt sınırı (dahil). */
  from?: Date;
  /** Karar tarihi üst sınırı (dahil). */
  to?: Date;
  /** Döndürülecek en fazla sonuç (varsayılan 20, tavan 50). */
  limit?: number;
}

/** Arama sonucu tek kayıt. */
export interface CaseLawHit {
  /** Ortak havuzdaki kayıt kimliği (CaseLawDocument.id). */
  caseLawId: string;
  court: string;
  chamber?: string;
  caseNumber: string;
  decisionNumber: string;
  decisionDate?: Date;
  summary?: string;
  sourceUrl?: string;
  sourceAdapter: string;
  /**
   * 0..1 alaka skoru. DETERMİNİSTİKTİR: terim eşleşmesinden hesaplanır,
   * LLM sıralaması değildir. AI yalnızca sorguyu genişletir.
   */
  score: number;
  /** Skorun nedeni: hangi terim hangi alanda geçti (kaynak gösterme ilkesi). */
  matchedTerms: string[];
  /** Kayıt seed/demo verisi mi? Dilekçe teyit kapısı bunları HAZIR'a geçirmez. */
  isDemo: boolean;
}

/** Künye ile nokta arama girdisi. */
export interface CaseLawCitationQuery {
  /**
   * ÇAĞIRAN KİRACI (ZORUNLU).
   *
   * Teyit de görünürlük süzgecine tabidir: başka bir büronun elle girdiği kayıt,
   * bu büronun atfını DOGRULANDI yapamaz. Aksi hâlde bir kiracı, sahte künyeler
   * girip başka bir büronun dilekçesini teyit kapısından geçirebilirdi.
   */
  tenantId: string;
  /** Metinden çıkarılan kaynak (YARGITAY/DANISTAY/BAM/AYM/AIHM) — biliniyorsa. */
  source?: string;
  /** Daire ifadesi, örn. "9. HD" — biliniyorsa. */
  chamber?: string;
  /** Esas no, "YYYY/N". */
  caseNumber: string;
  /** Karar no, "YYYY/N". */
  decisionNumber: string;
}

/**
 * Künye aramasının sonucu.
 *
 * FAIL-CLOSED: adaptör erişilemediğinde `SEARCH_FAILED` döner ve çağıran bunu
 * ASLA "doğrulandı" saymaz (Modül 23, iş kuralı 3).
 */
export interface CaseLawCitationLookup {
  outcome: "FOUND" | "NOT_FOUND" | "SEARCH_FAILED";
  record?: CaseLawDocument;
  /** Aynı künyeye birden çok kayıt döndüyse belirsizlik işareti. */
  ambiguous?: boolean;
  /** Adaptörün insan-okur notu (hata mesajı, kaynak adı). */
  note: string;
  adapterKey: string;
}

/** Adaptör sağlık durumu (Modül 23, ekran 10 / admin ucu). */
export interface CaseLawAdapterHealth {
  key: string;
  name: string;
  healthy: boolean;
  message: string;
  checkedAt: Date;
  canSearch: boolean;
  canFetchByCitation: boolean;
}

/**
 * Sağlayıcı-bağımsız içtihat kaynağı sözleşmesi.
 *
 * Yeni kaynak eklemek = bu arayüzü uygulayan bir sınıf + registry'ye kayıt.
 * Ürün kodu (servis/controller) adaptörün arkasını bilmez.
 */
export interface CaseLawSourceAdapter {
  /** Adaptör anahtarı — CaseLawDocument.sourceAdapter alanına yazılır. */
  readonly key: string;
  readonly name: string;
  /** Serbest metin araması destekliyor mu? */
  readonly canSearch: boolean;
  /** Künye ile nokta arama destekliyor mu? */
  readonly canFetchByCitation: boolean;

  search(query: string, filters: CaseLawFilters): Promise<CaseLawHit[]>;
  fetchByCitation(query: CaseLawCitationQuery): Promise<CaseLawCitationLookup>;
  healthCheck(): Promise<CaseLawAdapterHealth>;
}

/**
 * KİRACI GÖRÜNÜRLÜK SÜZGECİ — havuzdaki her okumaya uygulanır.
 *
 * `createdByTenantId = null` → kamusal/sistem kaydı (seed, resmî adaptörler).
 * `createdByTenantId = <kiracı>` → o büronun elle girdiği kayıt; başka büro göremez.
 */
export function tenantVisibility(tenantId: string): {
  OR: Array<{ createdByTenantId: string | null }>;
} {
  return { OR: [{ createdByTenantId: null }, { createdByTenantId: tenantId }] };
}

/** Seed/demo kayıtlarını işaretleyen adaptör anahtarları. */
// FEED_TEST: caselaw-ingest hattının bağlantı doğrulama fikstürü — besleme
// sözleşmesi örneğidir, gerçek karar içeriği DEĞİLDİR; havuza girse bile
// [DEMO VERİ] işaretlenir ve dilekçe teyit kapısından geçemez.
export const DEMO_SOURCE_ADAPTERS = new Set(["SEED_DEMO", "FEED_TEST"]);

export function isDemoRecord(record: { sourceAdapter: string }): boolean {
  return DEMO_SOURCE_ADAPTERS.has(record.sourceAdapter);
}
