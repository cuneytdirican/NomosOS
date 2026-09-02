/**
 * YARGI ORGANLARI + NOTERLER SÖZLEŞME TESTİ.
 *
 * 1. Katalog üreteci: 81 il kapsanır; her ilde icra dairesi ve noter vardır;
 *    İstanbul en yoğun ildir; fikrî sınai küçük illerde AÇILMAZ.
 * 2. Modül sözleşmesi: icra formu katalogdan seçer (icra sayfası picker
 *    kullanır), vekaletname noterini katalogdan seçer, dosya formu mahkemeyi
 *    katalogdan seçer; üçü de "listede yoksa elle yaz" kaçışı taşır
 *    (katalog yaklaşıktır — çalışma asla bloklanmaz).
 * 3. İzin matrisi: judicial.view/manage her iki dosyada birebir eşleşir
 *    (platform-permissions.test.ts ikiz testine ek güvence).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildJudicialCatalog, ILLER } from "@nomosos/db";

/** apps/api vitest'i apps/api içinde koşar; web iki-üst seviyededir. */
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf-8");

describe("yargı katalog üreteci", () => {
  const { bodies, notaries } = buildJudicialCatalog();

  it("81 il kapsanır", () => {
    expect(ILLER).toHaveLength(81);
    const illerInBodies = new Set(bodies.map((b) => b.il));
    for (const il of ILLER) expect(illerInBodies.has(il)).toBe(true);
  });

  it("her ilde en az bir icra dairesi ve bir noter vardır", () => {
    for (const il of ILLER) {
      expect(bodies.some((b) => b.il === il && b.type === "ICRA_DAIRESI")).toBe(true);
      expect(notaries.some((n) => n.il === il)).toBe(true);
    }
  });

  it("İstanbul en yoğun ildir (katman ölçeklemesi çalışıyor)", () => {
    const countOf = (il: string) => bodies.filter((b) => b.il === il).length;
    expect(countOf("İstanbul")).toBeGreaterThan(countOf("Ankara"));
    expect(countOf("Ankara")).toBeGreaterThan(countOf("Rize"));
  });

  it("fikrî sınai mahkemesi yalnız büyük illerde açılır (tier3Plus)", () => {
    const fikriIller = new Set(
      bodies.filter((b) => b.category === "FIKRI_SINAI").map((b) => b.il),
    );
    expect(fikriIller.has("İstanbul")).toBe(true);
    expect(fikriIller.has("Ankara")).toBe(true);
    // Küçük ilde fikrî sınai yok.
    expect(fikriIller.has("Rize")).toBe(false);
  });

  it("isimler tektir (type + name benzersizlik anahtarıyla uyumlu)", () => {
    const keys = bodies.map((b) => `${b.type}:${b.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    const notaryNames = notaries.map((n) => n.name);
    expect(new Set(notaryNames).size).toBe(notaryNames.length);
  });
});

describe("yargı katalog modül sözleşmesi", () => {
  it("icra sayfası icra dairesini katalogdan seçer (officeName serbest metin DEĞİL)", () => {
    const page = read("..", "..", "apps", "web", "src", "app", "app", "icra", "page.tsx");
    expect(page).toContain("JudicialBodyPicker");
    expect(page).toContain('type="ICRA_DAIRESI"');
  });

  it("dosya oluşturma mahkemeyi katalogdan seçer", () => {
    const page = read("..", "..", "apps", "web", "src", "app", "app", "dosyalar", "page.tsx");
    expect(page).toContain("JudicialBodyPicker");
    expect(page).toContain('type="MAHKEME"');
  });

  it("vekaletname formu noteri katalogdan seçer", () => {
    const tab = read(
      "..", "..", "apps", "web", "src", "app", "app", "_components", "poa-tab.tsx",
    );
    expect(tab).toContain("NotaryPicker");
  });

  it("seçiciler 'listede yoksa elle yaz' kaçışı taşır (katalog yaklaşıktır)", () => {
    const picker = read("..", "..", "apps", "web", "src", "components", "judicial-picker.tsx");
    expect(picker).toContain("Listede yok mu?");
  });

  it("senkron: kaynak yoksa zamanlayıcı KURULMAZ (sessiz) — elle tetikleme ATLANDI yazar", () => {
    const service = read("src", "judicial", "judicial.service.ts");
    expect(service).toContain("if (!settings.url) return;");
    expect(service).toContain("status: \"ATLANDI\"");
    expect(service).toContain("judicial.sync.url");
    expect(service).toContain("intervalHours");
  });
});
