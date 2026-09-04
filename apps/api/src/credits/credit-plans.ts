/**
 * KREDİ MATEMATİĞİ VE PLAN KOTALARI — saf fonksiyonlar, DB yok, LLM yok.
 *
 * docs/moduller/26-ai-kota-kredi-sistemi.md "Plan Kotaları" ve "İstek başına
 * üst sınır" bölümlerinin kodlanmış hâli. Buradaki hiçbir sayı AI'dan gelmez
 * ve hiçbiri float aritmetiğine bırakılmaz: krediler TAM SAYIDIR.
 */

/** Tek bir çağrı bu krediyi aşamaz (spec §İstek başına üst sınır, iş kuralı 5). */
export const MAX_CREDITS_PER_REQUEST = 50;

/**
 * Karakter → token kaba çevirimi.
 *
 * Türkçe metinde sondan eklemeli yapı yüzünden token/karakter oranı İngilizceden
 * daha yüksektir (yaklaşık 1/3). 3.5 SEÇİLDİ ki tahmin GERÇEKTEN OLANDAN AZ
 * ÇIKMASIN: rezervasyon eksik kalırsa kapı bakiyeyi koruyamaz.
 */
export const CHARS_PER_TOKEN = 3.5;

/** Bu token sayısına kadar taban fiyat uygulanır (uzun bağlam çarpanı yok). */
export const CONTEXT_FREE_TOKENS = 8_000;

/** Her ek 8.000 token bloğu taban fiyata %25 ekler. */
export const CONTEXT_BLOCK_TOKENS = 8_000;
export const CONTEXT_BLOCK_SURCHARGE = 0.25;

/** Karakter sayısından kaba token tahmini. */
export function approximateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Uzun bağlam çarpanı.
 *
 * 8.000 token'a kadar 1.00 · 16.000'e kadar 1.25 · 24.000'e kadar 1.50 …
 * Kademeli olması bilinçlidir: sürekli bir formül, aynı işlemin fiyatını her
 * seferinde biraz farklı gösterirdi ve "kaç kredi tüketeceğim" sorusunun
 * cevabı öngörülemez olurdu (Kullanıcı Hikâyesi 2).
 */
export function contextMultiplier(approxInputTokens: number): number {
  if (approxInputTokens <= CONTEXT_FREE_TOKENS) return 1;
  const blocks = Math.ceil((approxInputTokens - CONTEXT_FREE_TOKENS) / CONTEXT_BLOCK_TOKENS);
  return 1 + blocks * CONTEXT_BLOCK_SURCHARGE;
}

/**
 * Taban fiyat + uzun bağlam çarpanı → tam sayı kredi.
 * Ücretsiz görevlerde (taban 0) sonuç her zaman 0'dır.
 */
export function estimateCredits(baseCredits: number, approxInputTokens: number): number {
  if (baseCredits <= 0) return 0;
  return Math.ceil(baseCredits * contextMultiplier(approxInputTokens));
}

export interface CreditUnits {
  /** Birim (parça) sayısı — her birim AYRI bir sağlayıcı çağrısıdır. */
  count: number;
  /** Bir birimin yaklaşık karakter uzunluğu. */
  charsPerUnit: number;
}

/**
 * PARÇA BAZLI FİYATLAMA — toplam = parça sayısı × parça başına tahmin.
 *
 * NEDEN ÇARPIM VAR, TAVAN NEDEN YOK: `MAX_CREDITS_PER_REQUEST` TEK bir
 * sağlayıcı çağrısını korur; parça bazlı bir koşu ise N AYRI çağrıdır
 * (map-reduce). Tavan bu yüzden PARÇA BAŞINA uygulanır (bir parçanın
 * kendisi tavanı aşarsa istek reddedilir); toplam, parça sayısıyla dürüstçe
 * ölçeklenir — 20 parçalık bir koşu 20 çağrının bedelini öder, tek çağrı
 * fiyatına indirilemez.
 */
export function estimateUnitsCredits(baseCredits: number, units: CreditUnits): {
  perUnit: number;
  total: number;
} {
  const count = Math.max(1, Math.floor(units.count));
  const perUnit = estimateCredits(baseCredits, approximateTokens(units.charsPerUnit));
  return { perUnit, total: perUnit * count };
}

/**
 * Kullanılabilir bakiye — cüzdanın TEK doğru formülü.
 * `kullanılabilir = (dahil − tüketilen) + satın alınan − rezerve`
 */
export function availableCredits(wallet: {
  includedCredits: number;
  includedConsumed: number;
  purchasedCredits: number;
  reservedCredits: number;
}): number {
  return (
    wallet.includedCredits -
    wallet.includedConsumed +
    wallet.purchasedCredits -
    wallet.reservedCredits
  );
}

/** Rezerve HARİÇ bakiye — hareket defterindeki `balanceAfter` bu değeri taşır. */
export function settledBalance(wallet: {
  includedCredits: number;
  includedConsumed: number;
  purchasedCredits: number;
}): number {
  return wallet.includedCredits - wallet.includedConsumed + wallet.purchasedCredits;
}

/**
 * Manuel düzeltmenin bakiyeyi negatife düşürüp düşürmediği — TEK KAYNAK.
 *
 * ÜÇ YERDE aynı kontrol yapılır (kredi motoru, platform servisi, onay
 * yürütücüsü) ve üçü de yalnız `purchasedCredits`e bakıyordu. REZERVE
 * SAYILMAZSA şu senaryo bakiyeyi negatife düşürür: purchased=100,
 * reserved=100 (uçuşta çağrılar) iken onaylı -100 düzeltmesi geçer,
 * purchased=0 olur; uçuştaki çağrı mahsuplaştığında 100 daha düşülür ve
 * purchased = -100 kalır.
 *
 * Doğru ölçüt KULLANILABİLİR bakiyedir: rezerve krediler harcanmak üzere
 * söz verilmiş kredilerdir, boşta duran bakiye değildir.
 *
 * @returns hata mesajı, ya da sığıyorsa `null`.
 */
export function adjustmentRejection(
  wallet: {
    includedCredits: number;
    includedConsumed: number;
    purchasedCredits: number;
    reservedCredits: number;
  },
  delta: number,
): string | null {
  if (delta >= 0) return null;
  const available = availableCredits(wallet);
  if (available + delta >= 0) return null;
  return (
    `Kullanılabilir bakiye ${available} kredi (satın alınan ${wallet.purchasedCredits}, ` +
    `uçuştaki çağrılar için rezerve ${wallet.reservedCredits}); ${Math.abs(delta)} kredi ` +
    "düşülemez. Kredi bakiyesi negatife çekilemez."
  );
}

export interface PlanQuota {
  credits: number;
  documents: number;
  /** Kota hesabının kaynağı — dönem yenileme yanıtında görünür. */
  basis: string;
}

/**
 * Plan → dönem kotası (spec "Plan Kotaları" tablosu).
 *
 * ENTERPRISE SÖZLEŞMEYE BAĞLIDIR ve burada bir sayı UYDURULMAZ: dönem
 * yenilemesinde cüzdanın mevcut `includedCredits` değeri korunur. Platform
 * paneli o değeri elle (dört-göz onayıyla) belirler.
 */
export function planQuota(
  planKey: string | null | undefined,
  seats: number,
  current: { includedCredits: number; documentQuota: number },
): PlanQuota {
  const key = (planKey ?? "").toUpperCase();
  const safeSeats = Math.max(1, Math.floor(seats) || 1);

  if (key === "SOLO") {
    return { credits: 500, documents: 200, basis: "Solo planı — sabit 500 kredi / 200 belge." };
  }
  if (key === "BURO" || key === "BÜRO" || key === "OFFICE") {
    return {
      credits: 400 * safeSeats,
      documents: 250 * safeSeats,
      basis: `Büro planı — kullanıcı başına 400 kredi × ${safeSeats} koltuk (havuz büro genelinde ortaktır).`,
    };
  }
  return {
    credits: current.includedCredits,
    documents: current.documentQuota,
    basis:
      key === "ENTERPRISE"
        ? "Enterprise planı sözleşmeye bağlıdır; kota otomatik türetilmez, cüzdandaki değer korunur."
        : `"${planKey ?? "-"}" planı için kota tanımı yok; cüzdandaki değer korunur.`,
  };
}

/** Bir sonraki dönem penceresi (UTC ay başı, bitiş DIŞLAYICI). */
export function nextPeriod(from: Date): { periodStart: Date; periodEnd: Date } {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  return {
    periodStart: new Date(Date.UTC(y, m, 1)),
    periodEnd: new Date(Date.UTC(y, m + 1, 1)),
  };
}

/**
 * Kullanım yüzdesi — %80 amber, %100 kırmızı eşiklerinin dayanağı.
 *
 * Payda "dahil kota + ELDEKİ satın alınmış bakiye"dir. `purchasedCredits`
 * tüketimle azaldığı için bu, o ana kadar tüketilmiş satın alınmış krediyi
 * paydada saymaz; yani gösterge, ek paket alındığında geriye doğru
 * "eskisinden az tüketmişim" demez — yüzde düşer çünkü elde daha çok kredi
 * vardır. Kullanıcıya gösterilen asıl sayı zaten KALAN'dır; yüzde bir
 * uyarı eşiğidir, muhasebe değildir.
 */
export function usagePercent(wallet: {
  includedCredits: number;
  includedConsumed: number;
  purchasedCredits: number;
}): number {
  const total = wallet.includedCredits + wallet.purchasedCredits;
  if (total <= 0) return 0;
  const remaining = Math.max(0, settledBalance(wallet));
  return Math.min(100, Math.max(0, Math.round(((total - remaining) / total) * 100)));
}
