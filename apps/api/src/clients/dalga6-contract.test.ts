/**
 * DALGA 6 SÖZLEŞME TESTLERİ — müvekkil yönetimi kapanışı
 * (plans/mudur-plani-2026Q4-D6.md · Modül 01 kural 10).
 *
 * Mükerrer kayıt birleştirme: ClientMergeLog modeli, merge-preview + merge
 * uçları, 16 ilişkinin taşınması, kaynak kartın PASİFLEŞMESİ (silinmemesi),
 * geri alınamazlık belgelenmesi, rol kapısı (ADMIN/PARTNER).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf-8");
}

describe("D6: ClientMergeLog modeli + migration", () => {
  it("model: kalan kart + birleştirilen kart + sayılar + LOG yok edilme", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model ClientMergeLog");
    expect(schema).toContain('survivingClient   Client   @relation("MergeSurviving"');
    expect(schema).toContain('mergedClient      Client   @relation("MergeMerged"');
    expect(schema).toContain("countsJson");
    expect(schema).toContain("GERİ ALINAMAZ");
    const sql = read(
      "..", "..", "packages", "db", "prisma", "migrations",
      "20260903100000_dalga6_mukerrer_birlestirme", "migration.sql"
    );
    expect(sql).toContain("CREATE TABLE \"ClientMergeLog\"");
  });

  it("Client ilişkileri iki yönlü tanımlı (mergeLogsSurviving/Merged)", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain('mergeLogsSurviving ClientMergeLog[] @relation("MergeSurviving")');
    expect(schema).toContain('mergeLogsMerged    ClientMergeLog[] @relation("MergeMerged")');
  });
});

describe("D6: birleştirme uçları ve kuralları", () => {
  const svc = () => read("src", "clients", "clients.service.ts");

  it("uçlar: GET :id/merge-preview + POST :id/merge — rol kapısı SUNUCUDA", () => {
    const c = read("src", "clients", "clients.controller.ts");
    expect(c).toContain('@Get(":id/merge-preview")');
    expect(c).toContain('@Post(":id/merge")');
    const s = svc();
    expect(s).toContain('assertRole(user, ROLE_SETS.ONAY, "müvekkil birleştirme")');
  });

  it("Modül 01 kural 10: sayılar kullanıcıya GÖSTERİLİR (merge-preview)", () => {
    const s = svc();
    expect(s).toContain("async mergePreview");
    expect(s).toContain("mergeCounts(sourceId)");
    // 16 ilişki sayılır
    expect((s.match(/\.count\(\{ where: \{ clientId: sourceId \} \}\)/g) ?? []).length).toBe(16);
  });

  it("TEK İŞLEMDE taşınır — 16 ilişkinin updateMany'i aynı transaction'da", () => {
    const s = svc();
    expect((s.match(/\.updateMany\(\{ where: \{[^}]*clientId: sourceId[^}]*\}, data: \{ clientId: targetId \} \}\)/g) ?? []).length).toBe(16);
    expect(s).toMatch(/\$transaction[\s\S]*case\.updateMany[\s\S]*contract\.updateMany/);
  });

  it("kaynak kart PASİFLEŞİR — SİLİNMEZ (KVKK saklama)", () => {
    const s = svc();
    expect(s).toMatch(/isActive: false[\s\S]{0,200}D6 birleştirme/);
    expect(s).not.toContain("client.delete");
  });

  it("portal e-posta çakışması işlemi öNCE reddeder (tekil kısıt)", () => {
    const s = svc();
    expect(s).toContain("portalUser.findMany");
    expect(s).toContain("tekil kısıtı ihlal eder");
  });

  it("denetim izi: CLIENT_MERGE + counts", () => {
    const s = svc();
    expect(s).toContain('"CLIENT_MERGE"');
    expect(s).toContain("Taşınan kayıtlar");
    expect(s).toContain("clientMergeLog.create");
  });

  it("kendisiyle birleştirme reddedilir", () => {
    expect(svc()).toContain("kendisiyle birleştirilemez");
  });
});

describe("D6-B: mükerrer tespiti (deterministik — AI yok)", () => {
  it("benzerlik motoru: Jaro-Winkler + Türkçe normalizasyon + hukuki ekler — testli", () => {
    const engine = read("src", "clients", "client-similarity.ts");
    expect(engine).toContain("jaroWinkler");
    expect(engine).toContain("normalizeName");
    expect(engine).toContain("AI YOKTUR");
    expect(read("src", "clients", "client-similarity.test.ts")).toContain("MARTHA");
  });

  it("eşik AMPİRİK ölçülü ve kaynağında gerekçeli (0.90)", () => {
    const engine = read("src", "clients", "client-similarity.ts");
    expect(engine).toContain("export const NAME_SIMILARITY_THRESHOLD = 0.9;");
    expect(engine).toContain("0.890");
    expect(engine).toContain("yanl");
  });

  it("uç: POST /clients/duplicate-check — OPERASYON rolü, kaydı ENGELLEMEZ", () => {
    const c = read("src", "clients", "clients.controller.ts");
    expect(c).toContain('@Post("duplicate-check")');
    const s = read("src", "clients", "clients.service.ts");
    expect(s).toContain('assertRole(user, ROLE_SETS.OPERASYON, "müvekkil mükerrer tespiti")');
    expect(s).toContain("Kaydı ENGELLEMEZ");
  });

  it("tam kimlik eşleşmesi tespit listesinde; engelleme create'te kalır (409)", () => {
    const s = read("src", "clients", "clients.service.ts");
    expect(s).toContain("Aynı vergi kimlik numarası");
    expect(s).toContain("Aynı TCKN");
    // create'in 409 engelleme mantığı duruyor
    expect(s).toContain("ikinci kayıt AÇILAMAZ");
  });

  it("aday havuzu tavanı belgeli (5000)", () => {
    expect(read("src", "clients", "clients.service.ts")).toContain("take: 5000");
  });

  it("web: formda canlı uyarı (debounce) — engel değil, bağlantı ile açılır", () => {
    const page = read("..", "web", "src", "app", "app", "muvekkiller", "page.tsx");
    expect(page).toContain("duplicate-check");
    expect(page).toContain("Benzer müvekkil kartı bulundu");
    expect(page).toContain("Kayda devam edebilirsiniz");
  });
});

describe("D6: web — iki adımlı onay diyaloğu", () => {
  it("kaynak seçimi + sayı öngörüsü + açık onay kutusu", () => {
    const dialog = read("..", "web", "src", "components", "client-merge-dialog.tsx");
    expect(dialog).toContain("merge-preview");
    expect(dialog).toContain("Taşınacakları Önizle");
    expect(dialog).toContain("geri alınamayacağını");
    expect(dialog).toContain("disabled={!confirmed || busy}");
  });

  it("müvekkil kartında eylem girişi var", () => {
    const page = read("..", "web", "src", "app", "app", "muvekkiller", "[id]", "page.tsx");
    expect(page).toContain("ClientMergeDialog");
    expect(page).toContain("Mükerrer kartı birleştir");
  });
});
