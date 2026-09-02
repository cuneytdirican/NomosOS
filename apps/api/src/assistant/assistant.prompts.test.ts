/**
 * TARAFSIZLIK SÖZLEŞMESİ — yerel görev promptları (avukat geri bildirimi).
 *
 * Avukat geri bildirimi: "AI objektif olmalı; kendi dosyası diye taraflı
 * davranmamalı." Çekirdek kural (legal-ai system-core) HER composed prompta
 * otomatik girer; bu test yerel promptların kendi metinlerinde de tarafsız
 * çerçeveyi koruduğunu kanıtlar:
 *   1. Tam analiz promptu strengths/weaknesses'i AYNI titizlikle ister.
 *   2. Yerel promptlar composeSystemPrompt üzerinden çekirdeği taşır.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeSystemPrompt, NOMOSOS_SYSTEM_CORE_PROMPT } from "@nomosos/legal-ai";
import {
  caseFullAnalysisPrompt,
  buildLocalMessages,
  smartNotePrompt,
  officeQueryPrompt,
} from "./assistant.prompts";

const SOURCE = readFileSync(join(process.cwd(), "src", "assistant", "assistant.prompts.ts"), "utf-8");

describe("tarafsızlık sözleşmesi — yerel görev promptları", () => {
  it("tam analiz promptu strengths/weaknesses eşit titizlik ister", () => {
    const system = caseFullAnalysisPrompt.system;
    // Bölümler iki yönlü tanımlı:
    expect(system).toContain("strengths");
    expect(system).toContain("weaknesses");
    // Eşit titizlik kuralı açıkça yazılı:
    expect(system).toContain("TARAFSIZ ANALİZ");
    expect(system).toContain("AYNI titizlikle");
    expect(system).toContain("TARAF TUTMAKTIR");
    // Steelman ilkesi görev düzeyinde de geçerli:
    expect(system).toContain("en güçlü hâliyle");
  });

  it("yerel promptlar çekirdek tarafsızlık kuralıyla birleşir", () => {
    for (const spec of [caseFullAnalysisPrompt, smartNotePrompt, officeQueryPrompt]) {
      const messages = buildLocalMessages(spec, "içerik");
      const system = messages[0].content;
      expect(
        system.includes("TARAFSIZLIK — OBJEKTİF DEĞERLENDİRME"),
        `${spec.key} promptu tarafsızlık kuralını içermiyor`,
      ).toBe(true);
    }
  });

  it("composeSystemPrompt çekirdek kuralı önden taşır (kaynak taahhüdü)", () => {
    const composed = composeSystemPrompt("görev");
    expect(composed.startsWith(NOMOSOS_SYSTEM_CORE_PROMPT)).toBe(true);
    expect(composed).toContain("TARAFSIZLIK — OBJEKTİF DEĞERLENDİRME");
  });

  it("yerel prompt dosyası kaynağı tarafsızlık ilkesini belgeler", () => {
    // Prompt dosyası kendi başlığında ilkeyi belirtmelidir (kayıcı unutmaya karşı).
    expect(SOURCE).toContain("composeSystemPrompt");
  });
});
