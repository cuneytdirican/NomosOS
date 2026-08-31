/**
 * İ-21 REGRESYON TESTİ — metin kontrastı (WCAG 2.1 AA).
 *
 * Denetim bulgusu: `text-slate-400` (#94A3B8, beyaz üzerinde ~2,8:1) 50 dosyada
 * "ikincil metin" için kullanılıyordu; AA için 4,5:1 gerekir. Portalın `ink.faint`
 * token'ı da kağıt zeminde ~3,8:1 veriyordu.
 *
 * Karar: web'de slate-400 → slate-500 (#64748B, beyazda ~4,76:1); portalda
 * token tek noktadan koyulaştırıldı (#6E7B94 → #5B6880, kağıtta ~5,3:1).
 * Bu test sınıfın geri dönmesini tarayarak yakalar.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(entry)) yield p;
  }
}

/** Bağıl parlaklık (WCAG tanımı). */
function luminance(hex: string): number {
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i + 1, i + 3), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG kontrast oranı. */
function contrast(fgHex: string, bgHex: string): number {
  const l1 = luminance(fgHex);
  const l2 = luminance(bgHex);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const REPO = join(process.cwd(), "..", "..");

describe("İ-21: apps/web'de text-slate-400 kalmadı", () => {
  it("tüm tsx/ts dosyaları taranır — tek bir eşleşme bile kırmızıya düşürür", () => {
    const offenders: string[] = [];
    for (const p of walk(join(process.cwd(), "src"))) {
      // Test dosyaları atlanır: bu dosyanın kendi kalıbı metriği paralamasın.
      if (p.endsWith(".test.ts") || p.endsWith(".test.tsx")) continue;
      if (readFileSync(p, "utf-8").includes("text-slate-400")) {
        offenders.push(p.replace(process.cwd(), ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("süpürme slate-500'e yapıldı (değişim boşa gitmiş olamaz)", () => {
    let found = false;
    for (const p of walk(join(process.cwd(), "src"))) {
      if (readFileSync(p, "utf-8").includes("text-slate-500")) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("slate-500 beyaz ve slate-50 zeminlerde AA geçer (geçerli hedef)", () => {
    expect(contrast("#64748B", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#64748B", "#F8FAFC")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("İ-21: portal ink.faint token'ı AA geçiyor", () => {
  it("token değeri #5B6880'e koyulaştırıldı", () => {
    const config = readFileSync(join(REPO, "apps", "portal", "tailwind.config.ts"), "utf-8");
    expect(config).toContain('faint: "#5B6880"');
  });

  it("kağıt zeminlerde ≥ 4,5:1 kontrast", () => {
    // zeminler: paper #FBF9F5, paper-alt #F4F1EA (portal tailwind config)
    expect(contrast("#5B6880", "#FBF9F5")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#5B6880", "#F4F1EA")).toBeGreaterThanOrEqual(4.5);
  });

  it("eski değer (#6E7B94) AA'den düşüktü — bulgunun ölçümü doğru kalmalı", () => {
    expect(contrast("#6E7B94", "#FBF9F5")).toBeLessThan(4.5);
  });
});
