/**
 * SİMÜLASYON YOL SÖZLEŞMESİ — 404 regresyonu.
 *
 * HATA: arayüz POST /cases/:id/simulations çağırıyordu; sunucuda bu uç YOK.
 * Doğru uç POST /cases/:id/simulate'tir (GET /cases/:id/simulations listedir).
 * Bu test yol haritasını ikisi için de ayrı ayrı doğrular.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const lib = readFileSync(
  join(process.cwd(), "src", "app", "app", "_lib", "faz4.ts"),
  "utf-8",
);
const shared = readFileSync(
  join(process.cwd(), "..", "..", "packages", "shared", "src", "api-routes.ts"),
  "utf-8",
);

describe("simülasyon uç sözleşmesi", () => {
  it("POST ucu /simulate'dir — /simulations GET listesidir", () => {
    expect(lib).toContain("simulate: (caseId: string) => `/cases/${caseId}/simulate`");
    expect(lib).toContain("simulations: (caseId: string) => `/cases/${caseId}/simulations`");
  });

  it("runSimulation POST'u /simulate yoluna atar (404 hatasının kaynağı)", () => {
    expect(lib).toContain("FAZ4_ROUTES.simulate(caseId), { method: \"POST\", body }");
  });

  it("gövde 'params' zarfı taşımaz — alanlar EN ÜST DÜZEYDE gider", () => {
    // Sunucu şeması { mode, question?, documentId?, argumentCount?, piiApproved? }
    // bekler; params içine gömülü alanlar Zod tarafından sessizce atılırdı.
    expect(lib).not.toContain("body.params = params");
    expect(lib).toContain("body.documentId = docId");
  });

  it("paylaşılan katalogla uyumlu (tek kaynak)", () => {
    expect(shared).toContain("simulate: (caseId: string) => `/cases/${caseId}/simulate`");
    expect(shared).toContain("caseSimulations: (caseId: string) => `/cases/${caseId}/simulations`");
  });
});
