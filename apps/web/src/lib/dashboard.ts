/**
 * GET /dashboard/summary yanıtını tolere eden yardımcılar.
 * API bir alanı sayı, dizi ya da { count, items } biçiminde dönebilir;
 * panel her üç biçimi de doğru okur.
 */

import { asList } from "@/lib/api";

export function listOf<T>(value: unknown): T[] {
  return asList<T>(value);
}

/** Sayıya çevirebiliyorsa sayı, çeviremiyorsa null döner. */
export function countOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["count", "total", "value"]) {
      if (typeof obj[key] === "number") return obj[key] as number;
    }
    const list = asList(value);
    if (list.length > 0) return list.length;
  }
  return null;
}

/** Birden çok kaynaktan ilk geçerli sayıyı seçer. */
export function firstCount(...values: unknown[]): number {
  for (const v of values) {
    const n = countOf(v);
    if (n !== null) return n;
  }
  return 0;
}
