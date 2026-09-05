/**
 * Platform sağlayıcısı ile koşan görevlerde AiUsageLog FK ihlali (canlı bulgu):
 * yardımcı kimliği doğru sütuna dağıtır; sözleşme: her kullanım kaydı yazan
 * yürütücü bu yardımcıyı kullanır (ham `providerConfigId: config.id` kalmaz).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPlatformProviderId, usageProviderRef } from "./ai-usage-provider";

const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf-8");

describe("usageProviderRef", () => {
  it("kiracı sağlayıcısı → providerConfigId; platform → platformAiProviderId", () => {
    expect(usageProviderRef({ id: "abc" })).toEqual({ providerConfigId: "abc", platformAiProviderId: null });
    expect(usageProviderRef({ id: "platform:p1" })).toEqual({ providerConfigId: null, platformAiProviderId: "p1" });
    expect(isPlatformProviderId("platform:x")).toBe(true);
    expect(isPlatformProviderId("x")).toBe(false);
  });

  it("sözleşme: tüm AiUsageLog yazıcıları yardımcıyı kullanır; platform-ai öneki paylaşır", () => {
    for (const f of [
      ["ai", "ai.service.ts"],
      ["caselaw", "ai-runner.service.ts"],
      ["assistant", "assistant-llm.service.ts"],
      ["pipeline", "agent-runner.service.ts"],
    ]) {
      const src = read(...f);
      expect(src, f.join("/")).toContain("usageProviderRef(");
      expect(src, f.join("/")).not.toMatch(/providerConfigId:\s*config\.id/);
    }
    expect(read("ai", "platform-ai.service.ts")).toContain("PLATFORM_PROVIDER_ID_PREFIX");
    const schema = readFileSync(join(process.cwd(), "..", "..", "packages", "db", "prisma", "schema.prisma"), "utf-8");
    expect(schema).toContain("platformAiProviderId String?");
  });
});
