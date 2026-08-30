import type { UdfTextStyle } from "./types";

/** Karakter biçimlerini birleştirir; `override` içinde tanımlı alanlar kazanır. */
export function mergeStyle(base: UdfTextStyle | undefined, override: UdfTextStyle | undefined): UdfTextStyle {
  const result: UdfTextStyle = { ...(base ?? {}) };
  if (!override) return result;
  if (override.fontFamily !== undefined) result.fontFamily = override.fontFamily;
  if (override.fontSize !== undefined) result.fontSize = override.fontSize;
  if (override.bold !== undefined) result.bold = override.bold;
  if (override.italic !== undefined) result.italic = override.italic;
  if (override.underline !== undefined) result.underline = override.underline;
  if (override.strikethrough !== undefined) result.strikethrough = override.strikethrough;
  if (override.color !== undefined) result.color = override.color;
  return result;
}

/** İki biçmin alan alan eşitliği. */
export function styleEquals(a: UdfTextStyle | undefined, b: UdfTextStyle | undefined): boolean {
  const left = a ?? {};
  const right = b ?? {};
  return (
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    Boolean(left.bold) === Boolean(right.bold) &&
    Boolean(left.italic) === Boolean(right.italic) &&
    Boolean(left.underline) === Boolean(right.underline) &&
    Boolean(left.strikethrough) === Boolean(right.strikethrough) &&
    left.color === right.color
  );
}

/** `base` ile aynı olan alanları çıkararak yalnızca farkları döndürür. */
export function styleDiff(base: UdfTextStyle | undefined, full: UdfTextStyle): UdfTextStyle {
  const b = base ?? {};
  const diff: UdfTextStyle = {};
  if (full.fontFamily !== b.fontFamily && full.fontFamily !== undefined) diff.fontFamily = full.fontFamily;
  if (full.fontSize !== b.fontSize && full.fontSize !== undefined) diff.fontSize = full.fontSize;
  if (Boolean(full.bold) !== Boolean(b.bold)) diff.bold = Boolean(full.bold);
  if (Boolean(full.italic) !== Boolean(b.italic)) diff.italic = Boolean(full.italic);
  if (Boolean(full.underline) !== Boolean(b.underline)) diff.underline = Boolean(full.underline);
  if (Boolean(full.strikethrough) !== Boolean(b.strikethrough)) diff.strikethrough = Boolean(full.strikethrough);
  if (full.color !== b.color && full.color !== undefined) diff.color = full.color;
  return diff;
}

/** Biçimde hiç tanımlı alan yoksa true. */
export function isEmptyStyle(style: UdfTextStyle | undefined): boolean {
  if (!style) return true;
  return Object.values(style).every((value) => value === undefined);
}
