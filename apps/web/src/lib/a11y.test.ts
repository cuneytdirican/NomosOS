/**
 * ERİŞİLEBİLİRLİK REGRESYON TESTLERİ — denetim bulguları Ö-35, Ö-36.
 *
 * Ö-35: `Modal`'da odak tuzağı yoktu; Tab'a basan klavye kullanıcısının odağı
 * modalın ARKASINDAKİ sol menüye kaçıyordu. Tuzağın çekirdeği `nextFocusIndex`
 * sarma kuralıdır — burada doğrudan test edilir.
 *
 * Ö-36: Sekmelerde ARIA ve klavye gezinme yoktu; aktif sekme yalnız renkle
 * belirtiliyordu. `nextTabIndexForKey`, WAI-ARIA "tabs" deseninin ok tuşu /
 * Home / End kuralını uygular.
 */

import { describe, expect, it } from "vitest";
import { FOCUSABLE_SELECTOR, nextFocusIndex, nextTabIndexForKey } from "./a11y";

describe("nextFocusIndex — modal odak tuzağı (Ö-35)", () => {
  it("Tab ile ilerler", () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(1, 3, false)).toBe(2);
  });

  it("SON öğeden Tab ilk öğeye sarar — odak modalın DIŞINA çıkmaz", () => {
    expect(nextFocusIndex(2, 3, false)).toBe(0);
  });

  it("İLK öğeden Shift+Tab son öğeye sarar", () => {
    expect(nextFocusIndex(0, 3, true)).toBe(2);
  });

  it("Shift+Tab ile geriler", () => {
    expect(nextFocusIndex(2, 3, true)).toBe(1);
  });

  it("odak listede yoksa Tab ilk, Shift+Tab son öğeye götürür", () => {
    expect(nextFocusIndex(-1, 4, false)).toBe(0);
    expect(nextFocusIndex(-1, 4, true)).toBe(3);
  });

  it("tek odaklanabilir öğede daima aynı öğede kalır", () => {
    expect(nextFocusIndex(0, 1, false)).toBe(0);
    expect(nextFocusIndex(0, 1, true)).toBe(0);
  });

  it("odaklanabilir öğe yoksa -1 döner (çağıran diyaloğa odaklanır)", () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
  });

  it("seçici, devre dışı ve tabindex=-1 öğeleri dışarıda bırakır", () => {
    expect(FOCUSABLE_SELECTOR).toContain("button:not([disabled])");
    expect(FOCUSABLE_SELECTOR).toContain("[tabindex]:not([tabindex='-1'])");
    expect(FOCUSABLE_SELECTOR).toContain("input:not([disabled]):not([type='hidden'])");
  });
});

describe("nextTabIndexForKey — sekme klavye gezinmesi (Ö-36)", () => {
  it("sağ/aşağı ok bir sonraki sekmeye geçer", () => {
    expect(nextTabIndexForKey("ArrowRight", 0, 4)).toBe(1);
    expect(nextTabIndexForKey("ArrowDown", 1, 4)).toBe(2);
  });

  it("sol/yukarı ok bir önceki sekmeye geçer", () => {
    expect(nextTabIndexForKey("ArrowLeft", 2, 4)).toBe(1);
    expect(nextTabIndexForKey("ArrowUp", 1, 4)).toBe(0);
  });

  it("uçlarda başa sarar", () => {
    expect(nextTabIndexForKey("ArrowRight", 3, 4)).toBe(0);
    expect(nextTabIndexForKey("ArrowLeft", 0, 4)).toBe(3);
  });

  it("Home ilk, End son sekmeye götürür", () => {
    expect(nextTabIndexForKey("Home", 2, 4)).toBe(0);
    expect(nextTabIndexForKey("End", 0, 4)).toBe(3);
  });

  it("ilgisiz tuşlarda null döner — olay YUTULMAZ", () => {
    expect(nextTabIndexForKey("a", 0, 4)).toBeNull();
    expect(nextTabIndexForKey("Enter", 0, 4)).toBeNull();
    expect(nextTabIndexForKey("Tab", 0, 4)).toBeNull();
  });

  it("sekme yoksa null döner", () => {
    expect(nextTabIndexForKey("ArrowRight", 0, 0)).toBeNull();
  });
});
