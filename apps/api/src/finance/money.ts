/**
 * PARA ARİTMETİĞİ — DETERMİNİSTİK KATMAN.
 *
 * ÜRÜN İLKESİ: "para ve süre hesapları DETERMİNİSTİKTİR". Bu dosya, finans ve
 * faturalama modüllerinin TEK hesap kapısıdır. Kurallar:
 *
 *   1. JS `number` ile para toplanmaz/çarpılmaz. IEEE-754 ikili kayan nokta
 *      0.1 + 0.2 = 0.30000000000000004 üretir; 10.000 satırlık bir fatura
 *      dizisinde bu hata kuruşa taşar ve KDV beyanını bozar. Tüm işlemler
 *      `Prisma.Decimal` (decimal.js — sonsuz basamaklı ondalık) üzerindedir.
 *   2. Yuvarlama YALNIZCA kuruş sınırında ve YALNIZCA HALF_UP ile yapılır
 *      (Türk ticari teamülü ve GİB e-Fatura yuvarlama beklentisi).
 *   3. Ara toplamlar yuvarlanmadan taşınmaz: satır tutarı ve satır KDV'si
 *      kuruşa yuvarlanır, TOPLAMLAR bu yuvarlanmış satırların toplamıdır
 *      (bkz. invoice-math.ts). Böylece fatura üzerindeki satırların toplamı
 *      ile gösterilen genel toplam BİREBİR tutar.
 *   4. Prisma'ya yazarken daima `Prisma.Decimal` verilir, asla `Number`.
 *   5. API yanıtına çıkarken `moneyOut()` ile STRING'e çevrilir; `JSON.stringify`
 *      Decimal'i float gibi basıp kuruş kaybettirebilir.
 */

import { Prisma } from "@nomosos/db";

export type MoneyLike = string | number | Prisma.Decimal;

/** Kuruş hassasiyeti. */
export const MONEY_SCALE = 2;

/** Ticari yuvarlama: 0,005 → 0,01. */
export const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

export const ZERO = new Prisma.Decimal(0);
export const HUNDRED = new Prisma.Decimal(100);

/**
 * VARSAYILAN KDV ORANI.
 *
 * KODA GÖMÜLÜ SABİT DEĞİLDİR: her fatura satırı kendi `vatRate` alanını taşır ve
 * oran öncelikle ücret sözleşmesinden (`FeeAgreement.vatRate`) okunur. Bu değer
 * yalnızca hiçbir sözleşme bulunamadığında kullanılan BAŞLANGIÇ önerisidir ve
 * `DEFAULT_VAT_RATE` ortam değişkeniyle değiştirilebilir. Oran değişirse eski
 * faturalar etkilenmez — çünkü oran kayıtta saklanır.
 */
export function defaultVatRate(): Prisma.Decimal {
  const raw = process.env.DEFAULT_VAT_RATE?.trim();
  if (raw && /^\d{1,3}(?:\.\d{1,2})?$/.test(raw)) {
    const parsed = new Prisma.Decimal(raw);
    if (parsed.gte(0) && parsed.lte(100)) return parsed;
  }
  return new Prisma.Decimal(20);
}

/** Her tür girdiyi Decimal'e çevirir; null/undefined → 0. */
export function dec(value: MoneyLike | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(0);
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

/** Kuruşa HALF_UP yuvarlar. Tek yuvarlama noktası burasıdır. */
export function roundMoney(value: MoneyLike): Prisma.Decimal {
  return dec(value).toDecimalPlaces(MONEY_SCALE, ROUND_HALF_UP);
}

export function addMoney(...values: (MoneyLike | null | undefined)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(dec(v)), new Prisma.Decimal(0));
}

export function subMoney(a: MoneyLike | null | undefined, b: MoneyLike | null | undefined): Prisma.Decimal {
  return dec(a).minus(dec(b));
}

export function sumMoney(values: (MoneyLike | null | undefined)[]): Prisma.Decimal {
  return addMoney(...values);
}

/**
 * Dakika → saat (ondalık). Yuvarlama YOK: 450 dk = 7,5 sa tam olarak taşınır.
 * Sunum/fatura satırında `roundQuantity` ile 2 basamağa indirilir.
 */
export function minutesToHours(minutes: number): Prisma.Decimal {
  return new Prisma.Decimal(minutes).div(60);
}

/** Fatura satırı miktarı Decimal(12,2) alanına yazılır — aynı ölçekte yuvarla. */
export function roundQuantity(value: MoneyLike): Prisma.Decimal {
  return dec(value).toDecimalPlaces(2, ROUND_HALF_UP);
}

/**
 * Yüzde uygulaması: `base × rate / 100`, kuruşa HALF_UP yuvarlanmış.
 * KDV, başarı primi ve gecikme oranı hesaplarının tek yolu budur.
 */
export function applyPercent(base: MoneyLike, percent: MoneyLike | null | undefined): Prisma.Decimal {
  return roundMoney(dec(base).mul(dec(percent)).div(HUNDRED));
}

/** API yanıtı için kuruş kaybı olmayan string ("40000.00"). */
export function moneyOut(value: MoneyLike | null | undefined): string {
  return roundMoney(dec(value)).toFixed(MONEY_SCALE);
}

/** Yüzde alanı yanıtı ("20.00"). */
export function rateOut(value: MoneyLike | null | undefined): string {
  return dec(value).toDecimalPlaces(2, ROUND_HALF_UP).toFixed(2);
}

/** Para birimi kodu → gösterim eki. */
function currencySuffix(currency: string): string {
  return currency === "TRY" ? "TL" : currency;
}

/**
 * Türkçe biçimli gösterim: "1.240.000,00 TL".
 *
 * `Intl.NumberFormat` KULLANILMAZ — o, girdisini `number`'a çevirir ve büyük
 * tutarlarda kuruş kaybettirir. Biçimlendirme, yuvarlanmış Decimal'in
 * `toFixed(2)` çıktısı üzerinde saf STRING işlemiyle yapılır.
 */
export function formatMoneyTr(value: MoneyLike | null | undefined, currency = "TRY"): string {
  const fixed = roundMoney(dec(value)).toFixed(MONEY_SCALE);
  const negative = fixed.startsWith("-");
  const abs = negative ? fixed.slice(1) : fixed;
  const [intPart, fracPart] = abs.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${fracPart} ${currencySuffix(currency)}`;
}

/** Prisma `_sum` sonucu (Decimal | null) → Decimal. */
export function fromSum(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value ?? new Prisma.Decimal(0);
}

export function isPositive(value: MoneyLike | null | undefined): boolean {
  return dec(value).gt(0);
}

export function isNegative(value: MoneyLike | null | undefined): boolean {
  return dec(value).lt(0);
}
