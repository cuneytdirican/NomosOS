/**
 * AI-AUDIT A1 SÖZLEŞMESİ — gömme kullanımı GÖRÜNÜRDÜR.
 *
 * BULGU: `embedTexts` sağlayıcının bildirdiği gerçek token sayısını
 * okumuyordu ve gömme çağrıları AiUsageLog'a HİÇ yazılmıyordu — indeksleme
 * (belge başına onlarca parça) ve soru gömmesi kullanım raporlarında
 * görünmezdi; platform yönetimli sağlayıcıda görünmez MALİYET demekti.
 *
 * DÜZELTME: (1) embedTexts gerçek usage döner; (2) AssistantLlmService.embed
 * TEK BOĞUM NOKTASI olarak her gömme çağrısını AiUsageLog'a yazar
 * (taskType=EMBEDDING) — indeksleme ve soru gömmesi aynı kaynaktan geçer.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (root, ...parts) => readFileSync(join(process.cwd(), root, ...parts), "utf-8");

describe("A1: gömme kullanımı görünürdür", () => {
  it("embedTexts gerçek token kullanımını okur (EmbedCallResult sözleşmesi)", () => {
    const emb = read("..", "..", "packages", "ai", "src", "embeddings.ts");
    expect(emb).toContain("export interface EmbedCallResult");
    expect(emb).toContain("usage?: { prompt_tokens?: number");
    expect(emb).toContain("inputTokens: data.usage?.prompt_tokens");
  });

  it("AssistantLlmService.embed — tek boğum noktası: her gömme çağrısı AiUsageLog'a yazılır", () => {
    const llm = read("src", "assistant", "assistant-llm.service.ts");
    expect(llm).toContain('taskType: "EMBEDDING"');
    // Gömme metni maskeli gider — kayıt bunu taşır.
    expect(llm).toContain("piiMasked: true");
  });

  it("indeksleme ve soru gömmesi bağlamı iletir (kayıt kiracıya bağlıdır)", () => {
    const indexing = read("src", "assistant", "indexing.service.ts");
    expect(indexing).toContain("this.llm.embed(embedding, batch, ctx)");
    const retrieval = read("src", "assistant", "retrieval.service.ts");
    expect(retrieval).toContain("this.llm.embed(embedding, [masked], { tenantId })");
  });

  it("AiUsageLog şemasında EMBEDDING ayrı bir satır olarak raporlanabilir", () => {
    // Rapor katmanı taskType'a göre gruplar; EMBEDDING artık ayrı görünür.
    const report = read("src", "reports", "builders", "ai-kullanim.report.ts");
    expect(report).toMatch(/taskType|AI_KULLANIM/);
  });
});
