/**
 * Gömme sağlayıcısı çözümü — EMBEDDING görev rotası ÖNCELİKLİDİR.
 *
 * Canlı bulgu (5 Eylül 2026, LM Studio entegrasyonu): büro EMBEDDING rotasını
 * "LM Studio / nomic-embed" olarak tanımladığı hâlde indeksleme en eski
 * OPENAI_COMPAT kaydına (ulaşılamayan GLM sunucusu) ve varsayılan
 * "text-embedding-3-small" modeline gidiyor, "fetch failed" ile anahtar
 * kelime yedeğine düşüyordu.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@nomosos/ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@nomosos/ai")>();
  return { ...mod, decryptSecret: (s: string) => s.replace(/^enc:/, "") };
});

import { AssistantLlmService } from "./assistant-llm.service";

const lm = { id: "p-lm", tenantId: "t1", type: "OPENAI_COMPAT", isActive: true, encryptedApiKey: "enc:k", baseUrl: "http://26.40.106.213:1234/v1", defaultModel: "gemma", headersJson: null, mappingJson: null, createdAt: new Date("2026-09-05") };
const glm = { id: "p-glm", tenantId: "t1", type: "OPENAI_COMPAT", isActive: true, encryptedApiKey: null, baseUrl: "http://50.145.98.232:4000/v1", defaultModel: "glm", headersJson: null, mappingJson: null, createdAt: new Date("2026-08-31") };

function build(route: Record<string, unknown> | null, configs: Array<Record<string, unknown>>, platform: Record<string, unknown> | null = null) {
  const prisma = {
    client: {
      aiTaskRoute: { findUnique: vi.fn(async () => route) },
      aiProviderConfig: { findMany: vi.fn(async () => configs) },
      tenant: { findUnique: vi.fn(async () => ({ aiPolicy: "SERBEST", autoMaskConsent: false })) },
    },
  };
  const platformAi = { resolveForTenant: vi.fn(async () => platform) };
  const svc = new AssistantLlmService(prisma as any, { log: vi.fn() } as any, {} as any, platformAi as any);
  return { svc, prisma, platformAi };
}

describe("resolveEmbedding — EMBEDDING görev rotası", () => {
  it("rota varsa sağlayıcı + model rotadan gelir (en eski kayıt DEĞİL)", async () => {
    const { svc, prisma } = build({ taskType: "EMBEDDING", model: "text-embedding-nomic-embed-text-v1.5", providerConfig: lm }, [glm, lm]);
    const r = await svc.resolveEmbedding("t1");
    expect(r).toMatchObject({ providerConfigId: "p-lm", model: "text-embedding-nomic-embed-text-v1.5", providerType: "OPENAI_COMPAT" });
    expect(r?.config.baseUrl).toBe("http://26.40.106.213:1234/v1");
    expect(r?.config.apiKey).toBe("k");
    expect(prisma.client.aiTaskRoute.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_taskType: { tenantId: "t1", taskType: "EMBEDDING" } } }),
    );
  });

  it("rota yoksa eski sezgi: ilk OPENAI_COMPAT + varsayılan model", async () => {
    const { svc } = build(null, [glm, lm]);
    const r = await svc.resolveEmbedding("t1");
    expect(r).toMatchObject({ providerConfigId: "p-glm", model: "text-embedding-3-small" });
  });

  it("büronun kendi sağlayıcısı yoksa PLATFORM sağlayıcısı kullanılır (D1.3); platform gömme desteklemiyorsa null", async () => {
    const platform = { ...lm, id: "platform:pf1", tenantId: "__platform__" };
    const { svc, platformAi } = build(null, [], platform);
    const r = await svc.resolveEmbedding("t1");
    expect(r).toMatchObject({ providerConfigId: "platform:pf1", model: "text-embedding-3-small", providerType: "OPENAI_COMPAT" });
    expect(platformAi.resolveForTenant).toHaveBeenCalledWith("t1");
    const anthropic = build(null, [], { ...platform, type: "ANTHROPIC" });
    expect(await anthropic.svc.resolveEmbedding("t1")).toBeNull();
    // Kiracı sağlayıcısı varken platforma gidilmez.
    const own = build(null, [glm], platform);
    expect((await own.svc.resolveEmbedding("t1"))?.providerConfigId).toBe("p-glm");
    expect(own.platformAi.resolveForTenant).not.toHaveBeenCalled();
  });

  it("rota pasif sağlayıcıya ya da gömme desteklemeyen tipe işaret ediyorsa yedeğe düşer", async () => {
    const inactive = build({ taskType: "EMBEDDING", model: "x", providerConfig: { ...lm, isActive: false } }, [glm]);
    expect((await inactive.svc.resolveEmbedding("t1"))?.providerConfigId).toBe("p-glm");
    const anthropic = build({ taskType: "EMBEDDING", model: "x", providerConfig: { ...lm, type: "ANTHROPIC" } }, []);
    expect(await anthropic.svc.resolveEmbedding("t1")).toBeNull();
  });
});
