/**
 * EĞİTİLMİŞ MODEL KAYDI İÇE AKTARMA — güvenlik sözleşmesi
 * (kullanıcı tanımlı model eğitimi, gereksinim 3; provider-secrets.test.ts deseni).
 *
 * Korunan taahhütler:
 *  1. Kiracı içe aktarma ucu createProvider'ın AYNI kapılarından geçer
 *     (rol + BYO plan kapısı + SSRF + şifreleme) — ayrı bir "kısa yol" yoktur.
 *  2. Kayıt origin=IMPORTED ile yazılır; denetim izinde MODEL_IMPORT görünür.
 *  3. Platform içe aktarma ucu aiProvider.manage yetkisi ister ve origin=IMPORTED yazar.
 *  4. Ağırlık dosyası yükleme ucu YOKTUR (yalnız kimlik/adres/anahtar).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf-8");

describe("kiracı: POST /ai/providers/import", () => {
  const service = read("ai", "ai.service.ts");
  const controller = read("ai", "ai.controller.ts");

  it("importTrainedModel createProvider'a origin=IMPORTED ile delege eder (kapılar ortak)", () => {
    expect(service).toContain('return this.createProvider(user, { ...rest, defaultModel: externalModelId }, "IMPORTED");');
    // createProvider içinde kapılar sırayla: rol → BYO plan → SSRF → politika.
    const fn = service.slice(service.indexOf("async createProvider("), service.indexOf("async deleteProvider("));
    expect(fn).toContain("assertRole(user, ROLE_SETS.ONAY");
    expect(fn).toContain("byoAllowed(user.tenantId)");
    expect(fn).toContain("validateProviderBaseUrl(input.baseUrl)");
    expect(fn).toContain("encryptSecret(input.apiKey)");
    expect(fn).toContain("origin,");
  });

  it("denetim izi MODEL_IMPORT; içe aktarılan model adı kayda düşer", () => {
    expect(service).toContain('origin === "IMPORTED" ? "MODEL_IMPORT" : "AI_PROVIDER_CREATE"');
  });

  it("uç: providers/import; model kimliği externalModelId (serbest defaultModel yok)", () => {
    expect(controller).toContain('@Post("providers/import")');
    expect(controller).toContain("aiProviderConfigSchema.omit({ defaultModel: true })");
    expect(controller).toContain("externalModelId");
    // Dosya yükleme (ağırlık) yok.
    expect(controller).not.toContain("FileInterceptor");
    expect(controller).not.toContain("multipart");
  });

  it("yanıt beyaz listesi origin taşır ama sır taşımaz", () => {
    const select = service.slice(service.indexOf("PROVIDER_PUBLIC_SELECT"), service.indexOf("type ProviderPublicRow"));
    expect(select).toContain("origin: true");
    const fn = service.slice(service.indexOf("function toPublicProvider"), service.indexOf("safeJsonParse"));
    expect(fn).toContain("origin: config.origin");
    expect(fn).not.toMatch(/encryptedApiKey:\s*config\.encryptedApiKey/);
  });
});

describe("platform: POST /admin/v1/ai/providers/import", () => {
  const controller = read("ai", "platform-ai-provider.controller.ts");
  const service = read("ai", "platform-ai.service.ts");

  it("uç aiProvider.manage ister ve origin=IMPORTED ile createProvider'a gider", () => {
    const idx = controller.indexOf('@Post("import")');
    expect(idx).toBeGreaterThan(-1);
    expect(controller.slice(idx, idx + 400)).toContain('@WritePermission("aiProvider.manage")');
    expect(controller).toContain('origin: "IMPORTED"');
  });

  it("servis origin'i yazar, denetim izi MODEL_IMPORT", () => {
    expect(service).toContain('origin: input.origin ?? "TANIMLI"');
    expect(service).toContain('input.origin === "IMPORTED" ? "MODEL_IMPORT"');
    expect(service).toContain("origin: r.origin");
  });
});
