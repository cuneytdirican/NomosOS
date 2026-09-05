/**
 * PARA ALANLARININ SERİLEŞTİRİLMESİ.
 *
 * Prisma `Decimal` alanları `JSON.stringify` tarafından düz sayıya çevrilir;
 * 347500.10 gibi bir değer istemcide IEEE-754 çift duyarlıklı bir `number`
 * olarak canlanır ve kuruş kaybı riski doğar. Bu yüzden İCRA MODÜLÜNÜN
 * DÖNDÜRDÜĞÜ HER PARASAL ALAN iki ondalıklı METİNDİR.
 *
 * Tarihler `Date` olarak bırakılır (Nest bunları ISO 8601'e çevirir).
 */

import { Prisma } from "@nomosos/db";

export type DecimalLike = Prisma.Decimal | string | number | null | undefined;

/** İki ondalıklı metin; null/undefined korunur. */
export function money(value: DecimalLike): string | null {
  if (value === null || value === undefined) return null;
  return new Prisma.Decimal(value).toFixed(2);
}

/** Zorunlu parasal alan — null gelmeyeceği bilinen yerlerde. */
export function requiredMoney(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

/** Yüzde alanı (faiz oranı) — iki ondalıklı metin. */
export function percent(value: DecimalLike): string | null {
  if (value === null || value === undefined) return null;
  return new Prisma.Decimal(value).toFixed(2);
}

interface FileLike {
  principalAmount: Prisma.Decimal;
  interestRate: Prisma.Decimal | null;
  [key: string]: unknown;
}

export function serializeFile<T extends FileLike>(file: T) {
  // Faz 6: interestKind alanı FileLike içinde geliyorsa olduğu gibi geçer (spread).
  return { ...file, principalAmount: requiredMoney(file.principalAmount), interestRate: percent(file.interestRate) };
}

export function serializeAction<T extends { amount: Prisma.Decimal | null }>(action: T) {
  return { ...action, amount: money(action.amount) };
}

export function serializeAsset<T extends { estimatedValue: Prisma.Decimal | null }>(asset: T) {
  return { ...asset, estimatedValue: money(asset.estimatedValue) };
}

export function serializeCollection<T extends { amount: Prisma.Decimal }>(collection: T) {
  return { ...collection, amount: requiredMoney(collection.amount) };
}
