/**
 * DALGA 4 SÖZLEŞME TESTLERİ (geliştirme planı D4 / A6).
 *
 * İcra derinliği: kıymet takdiri (İİK m.120), satış/artırma kaydı (m.106+),
 * konkordato/iflas süreç şeridi. Çoklu örnek sınırları AÇIKÇA belgelenir.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf-8");
}

describe("A6: kıymet takdiri + satış kaydı (İİK m.120 / m.106+)", () => {
  it("modeller: AssetValuation + AssetSale + ConcordatoProcess şemada", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model AssetValuation");
    expect(schema).toContain("model AssetSale");
    expect(schema).toContain("model ConcordatoProcess");
    // Paraya çevirme kayıtları kiracı süzgeçlidir.
    expect(schema).toMatch(/model AssetValuation \{[^}]*tenantId/s);
    expect(schema).toMatch(/model AssetSale \{[^}]*tenantId/s);
  });

  it("takdir: bilirkişi/icra memuru/encümen — İİK m.120 aktörleri", () => {
    const s = read("src", "enforcement", "enforcement-asset-market.service.ts");
    expect(s).toContain('"BILIRKISI"');
    expect(s).toContain('"ICRA_MEMURU"');
    expect(s).toContain('"ENCUMEN"');
    expect(s).toContain("m.120");
  });

  it("satış: açık artırma (m.111) + posta ile teklif (m.114) — iki yol", () => {
    const s = read("src", "enforcement", "enforcement-asset-market.service.ts");
    expect(s).toContain('"ACIK_ARTIRMA"');
    expect(s).toContain('"POSTA_ILE_TEKLIF"');
  });

  it("SATILDI sonucu mal durum şeridini İHLAL ETMEDEN taşır (422 korunur)", () => {
    const s = read("src", "enforcement", "enforcement-asset-market.service.ts");
    expect(s).toContain("ASSET_TRANSITIONS");
    expect(s).toContain("UnprocessableEntityException");
    expect(s).toContain('nextStatus = "SATILDI"');
  });

  it("SATILDI'da satış bedeli ZORUNLU", () => {
    const s = read("src", "enforcement", "enforcement-asset-market.service.ts");
    expect(s).toContain("satış bedeli zorunludur");
  });

  it("DÜRÜSTLÜK: otomatik yasal süre üretimi YOKTUR (m.106/3 koşulludur)", () => {
    const s = read("src", "enforcement", "enforcement-asset-market.service.ts");
    expect(s).toContain("süre üretimi");
    expect(s).not.toContain("createFromRule");
  });

  it("uçlar: /assets/:id/valuations + /assets/:id/sales", () => {
    const c = read("src", "enforcement", "enforcement.controller.ts");
    expect(c).toContain('@Get(":id/valuations")');
    expect(c).toContain('@Post(":id/valuations")');
    expect(c).toContain('@Get(":id/sales")');
    expect(c).toContain('@Post(":id/sales")');
  });

  it("web: icra detayında Takdir/Satış iletişim kutusu", () => {
    const page = read("..", "..", "apps", "web", "src", "app", "app", "icra", "[id]", "page.tsx");
    expect(page).toContain("/valuations");
    expect(page).toContain("/sales");
    expect(page).toContain("İİK m.120");
  });
});

describe("A6: konkordato / iflas süreç şeridi", () => {
  it("CONCORDATO şeridi: m.285-302 akışı — keyfi sıçrama 400", () => {
    const s = read("src", "concordato", "concordato.service.ts");
    expect(s).toContain("BASVURU");
    expect(s).toContain("GECICI_ERTELEME");
    expect(s).toContain("KESIN_ERTELEME");
    expect(s).toContain("ONAYLANDI");
    expect(s).toContain("geçilemez");
  });

  it("IFLAS şeridi: m.154-168 akışı (gecikme/karar/idaresi/infis)", () => {
    const s = read("src", "concordato", "concordato.service.ts");
    expect(s).toContain("TALEP");
    expect(s).toContain("GECIKME");
    expect(s).toContain("IFLAS_KARARI");
    expect(s).toContain("IFLAS_IDARESI");
    expect(s).toContain("INFIS");
  });

  it("DÜRÜSTLÜK: konkordato süre hükümleri için otomatik hesap YOK", () => {
    const s = read("src", "concordato", "concordato.service.ts");
    expect(s).toContain("otomatik yasal süre üretimi YOKTUR");
    expect(s).not.toContain("createFromRule");
  });

  it("rol kapısı: oluşturma + geçiş HUKUKI kümesi ister", () => {
    const s = read("src", "concordato", "concordato.service.ts");
    expect((s.match(/ROLE_SETS\.HUKUKI/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("web sayfası + navigasyon", () => {
    const page = read("..", "..", "apps", "web", "src", "app", "app", "konkordato", "page.tsx");
    expect(page).toContain("/concordatos");
    expect(page).toContain("m.285");
    const layout = read("..", "..", "apps", "web", "src", "app", "app", "layout.tsx");
    expect(layout).toContain("/app/konkordato");
  });

  it("rota kataloğunda", () => {
    const routes = read("..", "..", "packages", "shared", "src", "api-routes.ts");
    expect(routes).toContain("CONCORDATO_ROUTES");
    expect(routes).toContain("ASSET_MARKET_ROUTES");
  });
});

describe("Çoklu örnek (replicas>1) sınırları AÇIKÇA belgeli", () => {
  it("SSE olay veriyolu tek örnek sınırını yazar", () => {
    const s = read("src", "chat", "chat-events.service.ts");
    expect(s).toContain("tek örnek");
  });

  it("zamanlayıcı tekil koşu kilidi VAR (BullMQ lock)", () => {
    // job-runner-lock.test.ts varlığı — tekil koşu kilit testi.
    const test = read("src", "scheduler", "job-runner-lock.test.ts");
    expect(test).toContain("runningKeys");
  });
});
