/**
 * Para gösterimi — TAMSAYI KURUŞ aritmetiği.
 *
 * ÜRÜN İLKESİ: para hesapları DETERMİNİSTİKTİR ve SUNUCUYA aittir. Bu dosya
 * hesap yapmaz; sunucunun gönderdiği Decimal(18,2) **string**'lerini kayıpsız
 * biçimde ekrana basar.
 *
 * Neden `Number` değil:
 *  - Prisma Decimal alanları JSON'a `"40000.00"` (string) ya da düz sayı olarak
 *    düşebilir. `Number("...")` ikili kayan noktaya çevirir; 0,1 + 0,2 = 0,30000000000000004
 *    hatası fatura toplamında kuruş kaymasına dönüşür.
 *  - Bu yüzden değerler `bigint` kuruşa çevrilir, toplama/çıkarma yalnızca
 *    kuruş üzerinden yapılır, biçimlendirme en sonda bir kez uygulanır.
 *
 * İSTEMCİ TOPLAMLARI YALNIZCA ÖN İZLEMEDİR: fatura ara toplam/KDV/genel toplam
 * daima sunucudan okunur; `previewLineTotal` gibi yardımcılar kullanıcı formu
 * doldururken gösterilen tahmindir ve arayüzde bu şekilde etiketlenir.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: "₺",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

/** Ondalık metni/sayıyı tamsayı kuruşa çevirir. Ayrıştırılamazsa null. */
export function toKurus(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(2) : "") : String(value);
  const s = raw.trim();
  if (s === "") return null;
  const m = /^([+-])?(\d*)(?:[.,](\d+))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;

  const negative = m[1] === "-";
  const whole = BigInt(m[2] === "" ? "0" : m[2]);
  // Üçüncü haneye kadar oku: sunucu 2 hane gönderir, fazlası gelirse yarı-yukarı yuvarla.
  const frac = (m[3] ?? "").padEnd(3, "0");
  let kurus = whole * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) kurus += 1n;
  return negative ? -kurus : kurus;
}

/** Kuruş toplamı — istemci tarafı ÖN İZLEME toplamları için (float yok). */
export function sumKurus(values: Array<string | number | null | undefined>): bigint {
  let total = 0n;
  for (const v of values) total += toKurus(v) ?? 0n;
  return total;
}

/** Kuruş → "40000.00" (API'ye geri gönderilebilir kanonik biçim). */
export function kurusToDecimalString(kurus: bigint): string {
  const negative = kurus < 0n;
  const abs = negative ? -kurus : kurus;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

function groupThousands(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ".";
    out += digits[i];
  }
  return out;
}

/** Kuruş → "1.234.567,89 ₺" (tr-TR, Intl'e ve float'a dokunmadan). */
export function fmtKurus(kurus: bigint | null | undefined, currency = "TRY"): string {
  if (kurus === null || kurus === undefined) return "—";
  const negative = kurus < 0n;
  const abs = negative ? -kurus : kurus;
  const whole = groupThousands(String(abs / 100n));
  const frac = String(abs % 100n).padStart(2, "0");
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const body = `${negative ? "-" : ""}${whole},${frac}`;
  return symbol ? `${body} ${symbol}` : body;
}

/**
 * Sunucudan gelen tutarı ekrana basar. Değer ayrıştırılamazsa "—" döner —
 * kullanıcıya sıfır GÖSTERMEZ (0 ile "bilinmiyor" karıştırılmamalıdır).
 */
export function fmtAmount(
  value: string | number | null | undefined,
  currency = "TRY",
): string {
  return fmtKurus(toKurus(value), currency);
}

/** Ekranda yüzde gösterimi: "20,00%" (oran koda gömülmez, kayıttan gelir). */
export function fmtRate(value: string | number | null | undefined): string {
  const k = toKurus(value);
  if (k === null) return "—";
  return `%${fmtKurus(k, "")}`;
}

/**
 * Satır ÖN İZLEMESİ: miktar × birim fiyat (+ KDV). Kesin tutarı SUNUCU hesaplar;
 * bu yalnızca form doldurulurken gösterilen tahmindir.
 *
 * `quantity` Decimal(12,2) olabildiği için o da kuruş (yüzde-iki hane) tamsayısı
 * gibi ele alınır ve bölme en sonda tek seferde yapılır.
 */
export function previewLineTotal(
  quantity: string | number | null | undefined,
  unitPrice: string | number | null | undefined,
): bigint | null {
  const q = toKurus(quantity);
  const p = toKurus(unitPrice);
  if (q === null || p === null) return null;
  // q ve p ikisi de 10^-2 ölçekli → çarpım 10^-4 ölçekli; 100'e bölüp yarı-yukarı yuvarla.
  const scaled = q * p;
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const rounded = (abs + 50n) / 100n;
  return negative ? -rounded : rounded;
}

/** KDV ÖN İZLEMESİ: matrah (kuruş) × oran (%). */
export function previewVat(
  baseKurus: bigint | null,
  vatRate: string | number | null | undefined,
): bigint | null {
  if (baseKurus === null) return null;
  const rate = toKurus(vatRate); // %20 → 2000 (10^-2 ölçekli)
  if (rate === null) return null;
  const scaled = baseKurus * rate; // 10^-4 ölçekli yüzde
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const rounded = (abs + 5000n) / 10000n;
  return negative ? -rounded : rounded;
}

/** Yüzde payı (yaşlandırma çubuğu vb. — yalnız görselleştirme). */
export function sharePercent(part: bigint | null, total: bigint | null): number {
  if (part === null || total === null || total === 0n) return 0;
  const pct = Number((part * 1000n) / total) / 10;
  return Math.max(0, Math.min(100, pct));
}
