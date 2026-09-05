import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@nomosos/ai";
import type { PrismaClient } from "@nomosos/db";
import { ROTATION_TARGETS, planRotation, rotateRow } from "./rotate-master-key";

const OLD = "11".repeat(32);
const NEW = "22".repeat(32);

describe("rotate-master-key", () => {
  it("rotateRow: şifreli alanlar yeni anahtarla yeniden şifrelenir; düz/boş alanlara dokunulmaz", () => {
    const row = { id: "a", encryptedApiKey: encryptSecret("sk-eski", OLD), headersJson: null, plain: "acik" };
    const data = rotateRow(row, ["encryptedApiKey", "headersJson", "plain"], OLD, NEW);
    expect(Object.keys(data)).toEqual(["encryptedApiKey"]);
    expect(decryptSecret(data.encryptedApiKey, NEW)).toBe("sk-eski");
    expect(() => decryptSecret(data.encryptedApiKey, OLD)).toThrow();
  });

  it("planRotation: tüm hedef modelleri tarar; yanlış anahtarda satır hata listesine düşer, hiçbir şey yazılmaz", async () => {
    const rows: Record<string, Array<Record<string, unknown>>> = {
      aiProviderConfig: [{ id: "p1", encryptedApiKey: encryptSecret("k1", OLD), headersJson: encryptSecret("{}", OLD) }],
      platformAiProvider: [],
      tenant: [{ id: "t1", ssoClientSecret: encryptSecret("sso", OLD) }],
      user: [{ id: "u1", twoFactorSecret: null }],
      eInvoiceSettings: [{ id: "e1", credentialsEncrypted: encryptSecret("api", "33".repeat(32)) }], // farklı anahtar → hata
      webhookEndpoint: [{ id: "w1", encryptedSecret: encryptSecret("whsec", OLD) }],
    };
    const prisma = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { findMany: async () => v }])) as unknown as PrismaClient;
    const plan = await planRotation(prisma, OLD, NEW);
    expect(plan.rows.map((r) => `${r.model}/${r.id}`)).toEqual(["aiProviderConfig/p1", "tenant/t1", "webhookEndpoint/w1"]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain("eInvoiceSettings/e1");
    expect(ROTATION_TARGETS.map((t) => t.model)).toContain("eInvoiceSettings");
  });
});
