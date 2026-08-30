import { randomBytes } from "node:crypto";
import { Prisma } from "@nomosos/db";

/**
 * YANIT SERİLEŞTİRME YARDIMCILARI.
 *
 * İki tuzak vardır ve ikisi de sessizce bozar:
 *
 * 1. **BigInt** — `UsageSnapshot.storageBytes` BigInt'tir; `JSON.stringify`
 *    üzerinde "TypeError: Do not know how to serialize a BigInt" atar. Nest'in
 *    serileştiricisi de düşer. Yanıt nesnesi ELLE map'lenmeli, BigInt sayıya
 *    çevrilmelidir (2^53 ≈ 9 PB'a kadar güvenli).
 *
 * 2. **Decimal** — Prisma Decimal alanları JS'e `Prisma.Decimal` gelir.
 *    `a + b` STRING BİRLEŞTİRİR. `JSON.stringify` bunları düz sayı gibi basar
 *    ve kuruş kaybı riski doğar. Para daima `.toFixed(2)` ile STRING dönülür.
 */

/** Decimal → "1234.50" (string). null/undefined korunur. */
export function money(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Prisma.Decimal(value).toFixed(2);
}

/** Decimal → "20.00" (oran/yüzde alanları için, 2 hane). */
export function rate(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Prisma.Decimal(value).toFixed(2);
}

/** BigInt → number (JSON'a girebilir). */
export function bytes(value: bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

/** Sıfır değerli Decimal — toplama başlangıcı. */
export function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

/** Güvenli JSON çözümleme — bozuk kayıt yanıtı düşürmez. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * UTC gün başı. `UsageSnapshot.date` @db.Date'tir; yerel saatle gün üretmek
 * negatif ofsetli saat dilimlerinde günü kaydırır ve @@unique'i bozar.
 */
export function utcDay(input: Date): Date {
  const d = new Date(input.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** YYYY-MM-DD (UTC) — zaman serisi anahtarları için. */
export function isoDay(input: Date): string {
  return utcDay(input).toISOString().slice(0, 10);
}

/**
 * OTURUM/İSTEK KAPSAMLI TAKMA AD ÜRETİCİ.
 *
 * KVKK (spec §9 + admin/endpoints.ts denetim bulgusu 20): ANALYST_READONLY
 * rolüne tenant kimliği gösterilemez. Takma ad tenant id'sinden TÜRETİLMEZ —
 * türetilmiş ad (hash dahil) sözlük saldırısıyla tersine eşlenebilir ve zaman
 * içinde sabit kaldığı için tenant'ları izlemeye yarar. Bunun yerine her yanıt
 * için RASTGELE bir eşleme kurulur; yanıt içinde tutarlı, yanıtlar arasında
 * ilişkisizdir.
 */
export class Pseudonymizer {
  private readonly map = new Map<string, string>();

  alias(tenantId: string): string {
    const existing = this.map.get(tenantId);
    if (existing) return existing;
    const alias = `Tenant #${randomBytes(2).toString("hex").toUpperCase()}`;
    this.map.set(tenantId, alias);
    return alias;
  }
}

/** E-posta maskesi: "partner@demo.local" → "p*****r@demo.local". */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}*${domain}`;
  return `${local[0]}${"*".repeat(Math.min(5, local.length - 2))}${local[local.length - 1]}${domain}`;
}
