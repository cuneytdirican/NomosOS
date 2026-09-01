/**
 * İ-27 SÖZLEŞME TESTİ — rota kataloğu ↔ gerçek controller'lar.
 *
 * Kök neden (denetim raporu, "Sunucu sözleşmesi ile arayüz arasında bağ yok"):
 * uç adresleri istemcide elle yazılıyordu ve arayüz API'de OLMAYAN adreslere
 * çağrı yapıyordu ("Kesinleştir", "Ödeme kaydet" düğmeleri 404 alıyordu).
 * Katalog (`packages/shared/src/api-routes.ts`) tek kaynak yapıldı; bu test
 * katalogdaki HER YOLUN gerçekten bir controller'da var olduğunu kanıtlar:
 *
 *  1. Tüm controller kaynakları taranır (@Controller + HTTP dekoratörleri).
 *  2. Katalogdaki her değer (dizi ya da fonksiyon) bir yola çözülür.
 *  3. Dinamik parçalar her iki tarafta jokerleştirilip KARŞILAŞTIRILIR.
 *  4. Katalog, controller'ların TÜM temel öneklerini kapsamak zorundadır —
 *     yeni bir controller kataloğa eklenmeden yazılırsa test kırmızıya döner.
 *
 * Katalogdaki bir yol controller'dan silinirse ya da yazım farklıysa bu test
 * CI'da KIRMIZI döner — "var olmayan uç" sınıfı derleme değil ama commit
 * zamanında yakalanır.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as shared from "@nomosos/shared";

/* ------------------------------------------------------------------ *
 * 1) GERÇEK UÇLAR — controller kaynaklarından mekanik tarama
 * ------------------------------------------------------------------ */

interface Token { t: "ctrl" | "route"; i: number; base?: string; method?: string; sub?: string }

function scanController(source: string): Token[] {
  const tokens: Token[] = [];
  // Temel önek TIRNAKSIZ da boş olabilir: `@Controller()` (auth.controller).
  // Portal controller'ı composite dekoratör kullanır (`@PortalControllerDecorator("portal")`
  // → applyDecorators(Controller(path), …)); @Controller regex'i onu göremez —
  // portal öneki katalog tarafıyla eşleşsin diye composite AYRI YAKALANIR.
  const ctrlRe = /@(?:Controller|PortalControllerDecorator)\(\s*(?:["'`]([^"'`]*)["'`]\s*)?\)/g;
  const routeRe = /@(Get|Post|Patch|Put|Delete)\(\s*(?:["'`]([^"'`]*)["'`]\s*)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = ctrlRe.exec(source))) tokens.push({ t: "ctrl", base: m[1] ?? "", i: m.index });
  while ((m = routeRe.exec(source))) tokens.push({ t: "route", method: m[1], sub: m[2] ?? "", i: m.index });
  tokens.sort((a, b) => a.i - b.i);
  return tokens;
}

function collectControllerRoutes(): Set<string> {
  const routes = new Set<string>();
  const root = join(process.cwd(), "src");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith(".controller.ts")) {
        const src = readFileSync(p, "utf-8");
        let current: string | null = null;
        for (const tk of scanController(src)) {
          if (tk.t === "ctrl") current = tk.base ?? "";
          else if (current !== null) {
            const sub = tk.sub ? "/" + tk.sub.replace(/^\/+/, "") : "";
            routes.add(`/${current}${sub}`.replace(/\/+$/, "") || "/");
          }
        }
      }
    }
  };
  walk(root);
  return routes;
}

/** Dinamik parçaları jokere indirger: `:id` → `*`, `:contactId` → `*`. */
function routeShape(path: string): string {
  return path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith(":") ? "*" : s))
    .join("/");
}

/* ------------------------------------------------------------------ *
 * 2) KATALOG — paylaşılan paketten tüm *_ROUTES nesneleri
 * ------------------------------------------------------------------ */

const SENTINEL = "\u0001PID\u0001";

function catalogPaths(): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  for (const [exportName, value] of Object.entries(shared)) {
    if (!exportName.endsWith("_ROUTES")) continue;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === "string") {
        out.push({ label: `${exportName}.${key}`, path: entry });
      } else if (typeof entry === "function") {
        // Fonksiyon ARITY'sine göre sentinelle çağrılır; sentinel içeren
        // segmentler jokere iner. `undefined` sızarsa arity tahmini az gelmiştir.
        const fn = entry as (...args: string[]) => string;
        const call = (n: number) => fn(...Array<string>(n).fill(SENTINEL));
        let p = call(fn.length || 1);
        if (p.includes("undefined")) p = call((fn.length || 1) + 1);
        if (typeof p === "string" && !p.includes("undefined")) {
          out.push({ label: `${exportName}.${key}`, path: p });
        }
      }
    }
  }
  return out;
}

/** Katalog yolunu biçime indirger: sentinelli segment → `*`. */
function catalogShape(path: string): string {
  return path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => (s.includes(SENTINEL) ? "*" : s))
    .join("/");
}

const controllerShapes = new Set<string>();
for (const r of collectControllerRoutes()) controllerShapes.add(routeShape(r));

const catalog = catalogPaths();
const catalogShapeSet = new Set(catalog.map((c) => catalogShape(c.path)));

describe("İ-27: katalogdaki her yol gerçek bir controller ucudur", () => {
  it("katalog en az 25 modülü kapsıyor (üç modülün gerisine dönüş olmaz)", () => {
    const modules = new Set(
      Object.entries(shared)
        .filter(([name]) => name.endsWith("_ROUTES"))
        .map(([name]) => name),
    );
    expect(modules.size).toBeGreaterThanOrEqual(25);
  });

  it("katalogdaki HİÇBİR yol 404'e gitmiyor", () => {
    const missing = catalog.filter((c) => !controllerShapes.has(catalogShape(c.path)));
    expect(
      missing.map((m) => `${m.label} → ${m.path}`),
      `Katalogda olup controller'da OLMAYAN yollar: ${missing
        .map((m) => `${m.label} → ${m.path}`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("mevcut katalog yolları KALDIRILMIŞ değil (sayım gerilemez)", () => {
    expect(catalog.length).toBeGreaterThanOrEqual(120);
  });
});

describe("İ-27: katalog controller'ların temel öneklerini kapsıyor", () => {
  it("her controller temel öneki katalogda temsil ediliyor", () => {
    // Controller baz önekleri: yolun İLK statik segmenti (joker değil).
    const bases = new Set<string>();
    for (const shape of controllerShapes) {
      const first = shape.split("/")[0];
      if (first && first !== "*") bases.add(first);
    }
    const catalogFirsts = new Set(
      [...catalogShapeSet].map((s) => s.split("/")[0]).filter((s) => s && s !== "*"),
    );
    const uncovered = [...bases].filter((b) => !catalogFirsts.has(b));
    expect(
      uncovered,
      `Katalogda hiç yolu olmayan controller önekleri: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });
});
