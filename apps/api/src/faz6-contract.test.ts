/**
 * FAZ 6 SÖZLEŞME TESTLERİ — UYAP / icra / finans.
 *
 * Mimari kararları kaynağa bağlar (davranış birim/entegrasyon testlerinde):
 *  - Dönemli faiz: oran tablosu PLATFORM yönetimindedir; kod içinde uydurma oran YOKTUR
 *    (yalnız yasal faiz %9 göç satırı; avans faizi platformdan girilir).
 *  - Storno: tahsilat SİLİNMEZ; stornoAt dolu satır fatura ödeme toplamına ve bakiyeye GİRMEZ.
 *  - Timesheet: yalnız ONAYLANDI kayıtlar faturaya girer; kronometre kullanıcı başına tektir.
 *  - Tebligat: KEP/UETS sağlayıcı arayüzü env ile seçilir; sağlayıcısız kurulum Noop ile çalışır.
 *  - UYAP → dosya: müvekkil zorunlu; icra biriminde EnforcementFile de açılır.
 *  - Muhasebe CSV: TCKN/VKN alanı yoktur.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf-8");
}

describe("Faz 6.2: dönemli faiz", () => {
  it("şema: InterestRatePeriod + EnforcementFile.interestKind; göç yalnız YASAL %9 satırı ekler", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model InterestRatePeriod");
    expect(schema).toMatch(/model EnforcementFile \{[^}]*interestKind/s);
    const migration = read("..", "..", "packages", "db", "prisma", "migrations", "20260928100000_faz6_uyap_icra_finans", "migration.sql");
    expect(migration).toContain("InterestRatePeriod");
    expect(migration).toMatch(/'YASAL'/);
    // Avans faizi oranı koda GÖMÜLMEZ (TCMB duyurusuna göre platform girer).
    expect(migration).not.toMatch(/'AVANS'[^;]*\d{2}\.\d{2}/);
  });

  it("bakiye: dilimler dönem sınırlarında bölünür; oran yoksa faiz HESAPLANMAZ ve uyarı verilir", () => {
    const s = read("src", "enforcement", "balance.service.ts");
    expect(s).toContain("periodsFor(file.interestKind)");
    expect(s).toContain("accrueOne(");
    expect(s).toContain("HESAPLANMAMIŞTIR");
  });

  it("legal-core: calculatePeriodInterest dışa açık ve testli", () => {
    const idx = read("..", "..", "packages", "legal-core", "src", "faiz.ts");
    expect(idx).toContain("export function calculatePeriodInterest");
    expect(() => read("..", "..", "packages", "legal-core", "src", "__tests__", "faiz-donemli.test.ts")).not.toThrow();
  });

  it("tarife uçları: kiracı salt okur; platform yazar (judicial yetkisi)", () => {
    const c = read("src", "tarife", "tarife.controller.ts");
    expect(c).toContain('@Get("faiz-oranlari")');
    expect(c).toContain('@Get("harc-tarifesi/:yil")');
    expect(c).toContain("/faiz-oranlari`)");
    expect(c).toContain("/harc-tarifesi`)");
  });
});

describe("Faz 6.3: İİK süreleri + portföy", () => {
  it("haciz → satış isteme (İİK 106), kıymet takdiri → itiraz (İİK 128a) tetikleyicileri", () => {
    const s = read("src", "enforcement", "enforcement-deadlines.service.ts");
    expect(s).toContain('ruleKey: "IIK_SATIS_ISTEME"');
    expect(s).toContain('ruleKey: "IIK_KIYMET_TAKDIRI_ITIRAZ"');
    expect(s).toContain('ruleKey: "IIK_ITIRAZIN_KALDIRILMASI"');
    const rules = read("..", "..", "packages", "legal-core", "src", "rules.ts");
    for (const key of ["IIK_SATIS_ISTEME", "IIK_KIYMET_TAKDIRI_ITIRAZ", "IIK_ITIRAZIN_KALDIRILMASI", "IIK_TAHLIYE_EMRI_ITIRAZ"]) {
      expect(rules).toContain(`key: "${key}"`);
    }
  });

  it("portföy ucu sabit yol olarak :id'den ÖNCE tanımlı (route gölgelenmesi yok)", () => {
    const c = read("src", "enforcement", "enforcement.controller.ts");
    const portfolio = c.indexOf('@Get("portfolio")');
    const byId = c.indexOf('@Get(":id")');
    expect(portfolio).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    expect(portfolio).toBeLessThan(byId);
  });
});

describe("Faz 6.4: tebligat", () => {
  it("şema + modül kaydı + sağlayıcı env anahtarı", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model Tebligat");
    expect(schema).toContain("enum TebligatKanali");
    expect(read("src", "app.module.ts")).toContain("TebligatModule");
    expect(read("src", "tebligat", "tebligat-saglayici.ts")).toContain("TEBLIGAT_SAGLAYICI");
    expect(read("..", "..", ".env.example")).toContain("TEBLIGAT_SAGLAYICI");
  });

  it("tebliğ yöntemi süre motorunun kabul ettiği kümeden (ETEBLIGAT/POSTA/ELDEN)", () => {
    const s = read("src", "tebligat", "tebligat.service.ts");
    expect(s).toContain('"ETEBLIGAT"');
    expect(s).not.toContain('return "ELEKTRONIK"');
    const dto = read("src", "deadlines", "deadlines.dto.ts");
    expect(dto).toContain('"ETEBLIGAT"');
  });
});

describe("Faz 6.5: finans", () => {
  it("storno: silme yok, ters kayıt; stornoAt dolu tahsilat toplama girmez", () => {
    const p = read("src", "billing", "payments.service.ts");
    expect(p).toContain("async storno(");
    expect(p).toContain('type: "IADE"');
    // Faturaya bağlı tahsilat için sert silme kapalı; storno zorunlu.
    expect(p).toContain("Faturaya bağlı tahsilat silinemez; storno (ters kayıt) kullanın.");
    const inv = read("src", "billing", "invoices.service.ts");
    expect(inv).toContain("stornoAt: null");
    expect(inv).toContain(".filter((p) => !p.stornoAt)");
  });

  it("timesheet: yalnız ONAYLANDI faturalanır; kronometre userId @unique", () => {
    const inv = read("src", "billing", "invoices.service.ts");
    expect(inv).toContain('status: "ONAYLANDI"');
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toMatch(/model TimeTimer \{[^}]*userId\s+String\s+@unique/s);
    expect(schema).toMatch(/model TimeEntry \{[^}]*status/s);
    const c = read("src", "billing", "billing.controller.ts");
    // Sabit yollar :id'den önce (timer/pending), aksi halde "timer" bir id sanılır.
    expect(c.indexOf('@Get("time-entries/timer")')).toBeLessThan(c.indexOf('@Get("time-entries/:id")') === -1 ? Number.MAX_SAFE_INTEGER : c.indexOf('@Get("time-entries/:id")'));
    expect(c).toContain('@Get("time-entries/pending")');
  });

  it("muhasebe CSV: KVKK — kimlik numarası alanı yok; iki biçim", () => {
    const e = read("src", "finance", "finance-export.ts");
    // ExportEntry alanları arasında kimlik numarası YOK (yorumlar hariç, alan tanımı aranır).
    expect(e).not.toMatch(/^\s+(tckn|vkn|taxNumber|identityNumber)\??:/im);
    expect(e).toContain("toLucaCsv");
    expect(e).toContain("toLogoCsv");
    expect(read("src", "finance", "finance.controller.ts")).toContain('@Get("export")');
  });
});

describe("Faz 6.1: UYAP → dosya", () => {
  it("müvekkil zorunlu (uuid), icra biriminde EnforcementFile açılır, kuyruk kaydı çözülür", () => {
    const dto = read("src", "uyap", "uyap.dto.ts");
    expect(dto).toContain("createCaseFromQueueSchema");
    expect(dto).toMatch(/clientId: z\.string\(\)\.uuid/);
    expect(dto).toContain("icra: z");
    const s = read("src", "uyap", "uyap.service.ts");
    expect(s).toContain("async createCaseFromQueue(");
    expect(s).toContain("tx.enforcementFile.create(");
    expect(s).toContain("tx.uyapMatchQueue.update(");
    expect(read("src", "uyap", "uyap.controller.ts")).toContain('"match-queue/:id/create-case"');
  });

  it("eklenti: ICRA_DOSYA ayrıştırıcısı kayıtlı ve DTO'ya icra bloğu taşınır", () => {
    const idx = read("..", "uyap-extension", "src", "content", "parsers", "index.ts");
    expect(idx).toContain("icraDosyaParser");
    expect(idx).toContain('"ICRA_DOSYA"');
    const dto = read("..", "uyap-extension", "src", "types", "dto.ts");
    expect(dto).toContain("icra?: UyapIcraDosya | null");
  });

  it("paylaşılan rota sabitleri (FAZ6_ROUTES) web ile aynı yolları taşır", () => {
    const routes = read("..", "..", "packages", "shared", "src", "api-routes.ts");
    expect(routes).toContain("FAZ6_ROUTES");
    expect(routes).toContain("/enforcement/portfolio");
    expect(routes).toContain("/billing/time-entries/timer");
    expect(routes).toContain("/finance/export");
  });
});
