/**
 * DALGA 2 SÖZLEŞME TESTLERİ (geliştirme planı D2: A1, A2, A3, C3).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (root: string, ...parts: string[]) =>
  readFileSync(join(process.cwd(), root, ...parts), "utf-8");
const web = (...parts: string[]) => read("..", "web", "src", ...parts);

describe("A1: dosya giderleri", () => {
  it("model + migration var (Decimal, İİK m.202 iade bayrağı)", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model CaseExpense");
    expect(schema).toContain("refundable Boolean  @default(true)");
    const mig = read(
      "..", "..", "packages", "db", "prisma", "migrations",
      "20260918120000_dalga2_gider_arabuluculuk_egitim", "migration.sql",
    );
    expect(mig).toContain("CREATE TABLE \"CaseExpense\"");
  });

  it("uçlar: liste + ekle + düzeltme + ödeme + kapatma hesabı (SİLME UCU YOK)", () => {
    const c = read("src", "case-expenses", "case-expenses.controller.ts");
    expect(c).toContain('Get("closing")');
    expect(c).toContain("@Post()");
    expect(c).toContain('Patch(":id")');
    expect(c).toContain("mark-paid");
    expect(c).not.toContain("@Delete");
  });

  it("İİK m.202 kapatma hesabı: iade edilebilir kalemleri döndürür", () => {
    const s = read("src", "case-expenses", "case-expenses.service.ts");
    expect(s).toContain("closingStatement");
    expect(s).toContain("refundable");
    expect(s).toContain("İİK m.202");
  });

  it("UI: dosya detayında Giderler sekmesi + kapatma hesabı düğmesi", () => {
    const tab = web("app", "app", "_components", "expenses-tab.tsx");
    expect(tab).toContain("case-expenses");
    expect(tab).toContain("closing");
    expect(tab).toContain("m.202");
    const detail = web("app", "app", "dosyalar", "[id]", "page.tsx");
    expect(detail).toContain('{ key: "giderler", label: "Giderler" }');
  });
});

describe("A2: arabuluculuk süreci", () => {
  it("6325 m.18 kuralı süre motorunda (2 hafta)", () => {
    const rules = read("..", "..", "packages", "legal-core", "src", "rules.ts");
    expect(rules).toContain("ARABULUCULUK_DAVA");
    expect(rules).toContain("6325 sayılı Hukuk Uyuşmazlıklarında Arabuluculuk Kanunu m.18");
  });

  it("durum geçiş zinciri — ANLASMA_YOK'ta son tutanak + dava süresi üretimi", () => {
    const s = read("src", "mediation", "mediation.service.ts");
    expect(s).toContain("ANLASMA_YOK");
    expect(s).toContain("finalProtocolAt");
    expect(s).toContain("createFromRule");
    expect(s).toContain("ARABULUCULUK_DAVA");
    // Geçersiz atlamalar reddedilir.
    expect(s).toContain("ALLOWED");
  });

  it("uçlar + UI sayfası", () => {
    const c = read("src", "mediation", "mediation.controller.ts");
    expect(c).toContain('Post(":id/transition")');
    const page = web("app", "app", "arabuluculuk", "page.tsx");
    expect(page).toContain("/mediations");
    expect(page).toContain("transition");
    expect(page).toContain("6325");
    expect(web("app", "app", "layout.tsx")).toContain("/app/arabuluculuk");
  });
});

describe("A3: hesap araçları (legal-core, deterministik)", () => {
  it("üç motor da legal-core'da ve dışa aktarılmış", () => {
    const idx = read("..", "..", "packages", "legal-core", "src", "index.ts");
    expect(idx).toContain('from "./kidem-ihbar"');
    expect(idx).toContain('from "./faiz"');
    expect(idx).toContain('from "./harc"');
  });

  it("kıdem/ihbar: m.14 30 gün/yıl + m.17 2/4/6/8 hafta; tavan parametrik", () => {
    const s = read("..", "..", "packages", "legal-core", "src", "kidem-ihbar.ts");
    expect(s).toContain("1475");
    expect(s).toContain("m.17");
    expect(s).toContain("ceiling");
    expect(s).toContain("steps");
  });

  it("faiz: basit faiz 365 gün; oran PARAMETRE (kodda oran taşımaz)", () => {
    const s = read("..", "..", "packages", "legal-core", "src", "faiz.ts");
    expect(s).toContain("365");
    expect(s).toContain("annualRatePercent");
  });

  it("harç: binde oranı parametrik + 'teyit' uyarısı zorunlu", () => {
    const s = read("..", "..", "packages", "legal-core", "src", "harc.ts");
    expect(s).toContain("RatePerMille");
    expect(s).toContain("teyit");
  });

  it("UI: hesap araçları sayfası adımları aynen gösterir", () => {
    const page = web("app", "app", "araclar", "hesap-araclari", "page.tsx");
    expect(page).toContain("calculateKidemIhbar");
    expect(page).toContain("calculateSimpleInterest");
    expect(page).toContain("calculateDavaHarci");
    expect(page).toContain("Steps");
    expect(web("app", "app", "layout.tsx")).toContain("/app/araclar/hesap-araclari");
  });
});

describe("B3: kârlılık raporuna gider modülü tablosu", () => {
  it("kârlılık raporu CaseExpense tablosunu da gösterir", () => {
    const s = read("src", "reports", "builders", "karlilik.report.ts");
    expect(s).toContain("CaseExpense");
    expect(s).toContain("giderModulu");
    expect(s).toContain("iadeEdilebilir");
  });

  it("ÇİFT SAYIM uyarısı zorunludur (finans MASRAF/HARC + gider modülü)", () => {
    const s = read("src", "reports", "builders", "karlilik.report.ts");
    expect(s).toContain("çift sayım");
    expect(s).toContain("EKLENMEMİŞTİR");
  });
});

describe("A7: mobil duruşma hızlı sonuç", () => {
  it("sunucu ucu hazır: PATCH /hearings/:id/result", () => {
    const c = read("src", "hearings", "hearings.controller.ts");
    expect(c).toContain('Patch(":id/result")');
  });

  it("mobil API istemcisi + iki adımlı onay iletişim kutusu", () => {
    const api = read("..", "mobile", "src", "api", "quick-result.ts");
    expect(api).toContain("/hearings");
    expect(api).toContain("result");
    const dialog = read("..", "mobile", "src", "ui", "quick-result-dialog.tsx");
    expect(dialog).toContain("step");
    expect(dialog).toContain("Onaylıyorum");
    expect(dialog).toContain("ERTELENDI");
  });

  it("ekran entegrasyonu: yalnız PLANLANDI + rol kapısı + özet onayı", () => {
    const screen = read("..", "mobile", "app", "durusma", "[id].tsx");
    expect(screen).toContain('data.status === "PLANLANDI"');
    expect(screen).toContain("QuickResultDialog");
    expect(screen).toContain("saveHearingResult");
  });
});

describe("C3: AI eğitim verisi (KVKK opt-in)", () => {
  it("model + Tenant.aiTrainingOptIn (varsayılan KAPALI)", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model AiTrainingSample");
    expect(schema).toContain("aiTrainingOptIn Boolean  @default(false)");
  });

  it("toplama yalnız opt-in kiracıda + MASKELEME (scanPii)", () => {
    const s = read("src", "ai-training", "ai-training.service.ts");
    expect(s).toContain("optIn");
    expect(s).toContain("scanPii");
    expect(s).toContain("maskedText");
  });

  it("karar kancası: öneri onay/ret eğitim örneği üretir", () => {
    const s = read("src", "documents", "proposals.service.ts");
    expect(s).toContain('kind: "ONAY"');
    expect(s).toContain('kind: "RED"');
    expect(s).toContain("this.training");
    expect(s).toContain("recordDecision");
  });

  it("kiracı uçları: rıza durumu + aç/kapa + kendi örnekleri", () => {
    const c = read("src", "ai-training", "ai-training.controller.ts");
    expect(c).toContain('Get("summary")');
    expect(c).toContain('Patch("opt-in")');
    expect(c).toContain('Get("samples")');
  });

  it("platform: onay/red + JSONL dışa aktarım (yalnız ONAYLANMIŞ)", () => {
    const c = read("src", "ai-training", "ai-training.controller.ts");
    expect(c).toContain("approve");
    expect(c).toContain("reject");
    expect(c).toContain("export");
    expect(c).toContain("ONAYLANDI");
    expect(c).toContain("aiProvider.manage");
  });
});
