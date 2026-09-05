/**
 * KULLANICI TANIMLI MODEL EĞİTİMİ — sözleşme testleri
 * (.mindaeon/plans/1788544126809-kullanici-tanimli-model-egitimi.md).
 *
 * Gereksinim 1: yalnız KENDİ tanımladıkları (katalogdaki) modeller seçilebilir —
 *   serbest metin sağlayıcı/model girişi yoktur.
 * Gereksinim 2: lisanslı kiracı kendi modelini eğitir (tenant uçları + lisans kapısı).
 * Gereksinim 3: dışarıdan eğitilmiş model KAYDI içe aktarılır (origin=IMPORTED).
 * Terminoloji: "AI Eğitim İşleri" → "Model Eğitim İşleri".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf-8");
const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");

describe("Gereksinim 1 — model yalnız katalogdan seçilir", () => {
  it("şema: FineTuneJob tenantId/providerConfigId/platformAiProviderId; provider/baseModel anlık görüntü", () => {
    const block = schema.slice(schema.indexOf("model FineTuneJob {"), schema.indexOf("model SystemSetting {"));
    expect(block).toContain("tenantId        String?");
    expect(block).toContain("providerConfigId String?");
    expect(block).toContain("platformAiProviderId String?");
    expect(block).toContain("ANLIK GÖRÜNTÜSÜ");
    expect(block).toContain("@@index([tenantId, createdAt])");
    const sql = read(
      "..", "..", "packages", "db", "prisma", "migrations",
      "20260923090000_kullanici_tanimli_model_ve_aaut_platform", "migration.sql",
    );
    expect(sql).toContain('ADD COLUMN "platformAiProviderId" TEXT');
    expect(sql).toContain('"FineTuneJob_providerConfigId_fkey"');
  });

  it("platform şeması serbest metin provider/baseModel almaz; platformAiProviderId uuid ister", () => {
    const s = read("src", "platform", "fine-tune", "fine-tune.schemas.ts");
    expect(s).toContain("platformAiProviderId: z.string().uuid(");
    expect(s).not.toMatch(/provider:\s*z\s*\.string\(\)/);
    expect(s).not.toMatch(/baseModel:\s*z\s*\.string\(\)/);
  });

  it("platform servisi seçilen modeli katalogda AKTİF olarak doğrular ve anlık görüntü yazar", () => {
    const svc = read("src", "platform", "fine-tune", "fine-tune.service.ts");
    expect(svc).toContain("where: { id: input.platformAiProviderId, isActive: true }");
    expect(svc).toContain("platformAiProviderId: catalog.id");
    expect(svc).toContain("baseModel: catalog.defaultModel");
    // Platform listesi kiracı işlerine bakmaz.
    expect(svc).toContain("where: { tenantId: null }");
  });

  it("admin ekranı: serbest metin sağlayıcı/model girişi YOK, katalogdan select var", () => {
    const page = read("..", "admin", "src", "app", "(panel)", "egitim", "page.tsx");
    expect(page).not.toContain('provider: "OpenAI"');
    expect(page).not.toContain('baseModel: "gpt-4o-mini"');
    expect(page).toContain("platformAiProviderId");
    expect(page).toContain("EP.platformAi.list");
    expect(page).toContain("Model Eğitim İşleri");
  });
});

describe("Gereksinim 2 — lisanslı kiracı kendi modelini eğitir", () => {
  it("kiracı uçları: /ai-training/fine-tune-jobs (GET/POST/manifest/status)", () => {
    const c = read("src", "ai-training", "tenant-fine-tune.controller.ts");
    expect(c).toContain('@Controller("ai-training/fine-tune-jobs")');
    expect(c).toContain('@Get(":id/manifest")');
    expect(c).toContain('@Post(":id/status")');
  });

  it("servis: lisans kapısı + kiracı süzgeci + manifest yalnız kendi örnekleri", () => {
    const s = read("src", "ai-training", "tenant-fine-tune.service.ts");
    expect(s).toContain("byoAllowed(user.tenantId)");
    expect(s).toContain("ForbiddenException(TENANT_FINE_TUNE_LICENSE_MESSAGE)");
    expect(s).toContain("where: { tenantId: user.tenantId, exportStatus: \"ONAYLANDI\" }");
    expect(s).toContain("where: { id: input.providerConfigId, tenantId: user.tenantId, isActive: true }");
    // Sağlayıcıya otomatik gönderim yok.
    expect(s).not.toContain("fetch(");
  });

  it("web: /app/ayarlar/model-egitimi sayfası + menü", () => {
    const page = read("..", "web", "src", "app", "app", "ayarlar", "model-egitimi", "page.tsx");
    expect(page).toContain("/ai-training/fine-tune-jobs");
    expect(page).toContain("/assistant/index/");
    expect(page).toContain("licensed");
    const nav = read("..", "web", "src", "app", "app", "layout.tsx");
    expect(nav).toContain('"/app/ayarlar/model-egitimi"');
  });
});

describe("Gereksinim 3 — eğitilmiş model kaydı içe aktarma", () => {
  it("şema: AiProviderConfig.origin ve PlatformAiProvider.origin (TANIMLI | IMPORTED)", () => {
    expect((schema.match(/origin\s+String\s+@default\("TANIMLI"\)/g) ?? []).length).toBe(2);
    expect(schema).toContain("@@index([origin])");
  });

  it("web ve admin sağlayıcı ekranlarında içe aktarma modalı + rozet", () => {
    const web = read("..", "web", "src", "app", "app", "ayarlar", "ai-saglayici", "page.tsx");
    expect(web).toContain("/ai/providers/import");
    expect(web).toContain("İçe aktarıldı");
    const admin = read("..", "admin", "src", "app", "(panel)", "ai-saglayicilar", "page.tsx");
    expect(admin).toContain("EP.platformAi.import");
    expect(admin).toContain("İçe aktarıldı");
  });
});

describe("Terminoloji", () => {
  it('nav ve dokümanlar "Model Eğitim İşleri" der', () => {
    expect(read("..", "admin", "src", "lib", "nav.ts")).toContain('label: "Model Eğitim İşleri"');
    expect(read("..", "..", "docs", "moduller", "25-sistem-yonetim-paneli.md")).toContain("Model Eğitim İşleri");
    expect(read("..", "..", "docs", "test-ortami.md")).toContain("Model Eğitim İşleri");
  });
});
