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

describe("D7/M3: müvekkil segment kataloğu (kiracı bazlı yönetilen liste)", () => {
  it("model + migration: ClientSegment (kiracıya özgü, benzersiz ad)", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model ClientSegment");
    expect(schema).toContain("@@unique([tenantId, label])");
    const sql = read(
      "..", "..", "packages", "db", "prisma", "migrations",
      "20260903130000_dalga7_muvekkil_segment_katalogu", "migration.sql"
    );
    expect(sql).toContain("CREATE TABLE \"ClientSegment\"");
  });

  it("uçlar: GET/POST/PATCH /clients/segments — okuma OPERASYON, yazma ONAY", () => {
    const c = read("src", "clients", "clients.controller.ts");
    expect(c).toContain('@Get("segments")');
    expect(c).toContain('@Post("segments")');
    expect(c).toContain('@Patch("segments/:id")');
    const s = read("src", "clients", "clients.service.ts");
    expect(s).toContain('assertRole(user, ROLE_SETS.OPERASYON, "müvekkil segment listesi")');
    expect(s).toContain('assertRole(user, ROLE_SETS.ONAY, "müvekkil segment ekleme")');
  });

  it("silme YOKTUR — pasifleştirme; mevcut kayıtlar bozulmaz", () => {
    const c = read("src", "clients", "clients.controller.ts");
    expect(c).not.toContain('@Delete("segments');
    const s = read("src", "clients", "clients.service.ts");
    expect(s).toContain("pasifleştirilen segment");
  });

  it("ad değişimi mevcut müvekkil kayıtlarını TAŞIMAZ (denetim izinde not)", () => {
    expect(read("src", "clients", "clients.service.ts")).toContain(
      "adı değişen segment mevcut müvekkil kayıtlarını taşımaz"
    );
  });

  it("denetim izi: CLIENT_SEGMENT_CREATE/UPDATE", () => {
    const s = read("src", "clients", "clients.service.ts");
    expect(s).toContain('"CLIENT_SEGMENT_CREATE"');
    expect(s).toContain('"CLIENT_SEGMENT_UPDATE"');
  });

  it("web: segment alanı KATALOGDAN seçilir (datalist/serbest metin değil)", () => {
    const page = read("..", "web", "src", "app", "app", "muvekkiller", "[id]", "page.tsx");
    expect(page).toContain("/clients/segments");
    expect(page).toContain("— Kategorisiz —");
    // mevcut değer katalogda yoksa seçenek olarak KORUNUR (sessiz kayıp yok)
    expect(page).toContain("(listede yok)");
  });

  it("seed: demo büroya başlangıç segmentleri", () => {
    const seed = read("..", "..", "packages", "db", "src", "seed.ts");
    expect(seed).toContain('["Kurumsal", "Bireysel", "Kamu", "STK"]');
  });
});

describe("D8: dosya tarafı ↔ müvekkil kartı bağlantısı", () => {
  it("model + migration: CaseParty.clientId (SetNull)", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toMatch(/clientId\s+String\?/);
    expect(schema).toContain("caseParties      CaseParty[]");
    const sql = read(
      "..", "..", "packages", "db", "prisma", "migrations",
      "20260903140000_dalga8_taraf_muvekkil_baglantisi", "migration.sql"
    );
    expect(sql).toContain("ADD COLUMN \"clientId\"");
    expect(sql).toContain("ON DELETE SET NULL");
  });

  it("müvekkil tarafın adı SUNUCUDA karttan doldurulur (elle yazılamaz)", () => {
    const s = read("..", "..", "apps", "api", "src", "cases", "cases.service.ts");
    expect(s).toContain("name = client.name");
    expect(s).toContain("ad elle yazılamaz");
  });

  it("KARTSIZ 'müvekkilimiz' işareti REDDEDİLİR (kopuk kayıt engeli)", () => {
    const s = read("..", "..", "apps", "api", "src", "cases", "cases.service.ts");
    expect(s).toContain("Müvekkil taraf, müvekkil kartından SEÇİLEREK eklenir");
  });

  it("web: taraf ekleme diyaloğu — müvekkil RemoteSelect, karşı taraf serbest", () => {
    const page = read("..", "web", "src", "app", "app", "dosyalar", "[id]", "page.tsx");
    expect(page).toContain("Taraf Ekle");
    expect(page).toContain("RemoteSelect");
    expect(page).toContain("müvekkil kartından seçilir");
    // müvekkil tarafı listede KART bağlantısıyla gösterilir
    expect(page).toMatch(/p\.clientId \? \(/);
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
