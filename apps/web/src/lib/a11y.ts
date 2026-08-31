/**
 * Erişilebilirlik yardımcıları (denetim bulguları Ö-35, Ö-36).
 *
 * Buradaki mantık BİLEREK saf (DOM'suz) tutulmuştur: klavye gezinme kuralı ve
 * odaklanabilir öğe seçicisi birim testle doğrulanabilsin diye. DOM'a dokunan
 * kısım `components/ui.tsx` içindeki `Modal`/`Tabs` bileşenlerindedir.
 */

/** Odak tuzağının tarayacağı öğeler (denetim bulgusu Ö-35). */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Tab / Shift+Tab için bir sonraki odak indeksini döndürür — uçlarda BAŞA
 * SARAR. Odak tuzağının çekirdeği budur: son öğeden Tab ilk öğeye, ilk öğeden
 * Shift+Tab son öğeye gider; odak asla modalın arkasındaki sayfaya kaçmaz.
 *
 * `current` listede yoksa (-1) Tab ilk öğeye, Shift+Tab son öğeye götürür.
 * (denetim bulgusu Ö-35)
 */
export function nextFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

/**
 * WAI-ARIA "tabs" deseninin klavye kuralı: ←/→ komşu sekme (başa sarar),
 * Home ilk, End son sekme. Diğer tuşlar için `null` döner (olay yutulmaz).
 * (denetim bulgusu Ö-36)
 */
export function nextTabIndexForKey(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
