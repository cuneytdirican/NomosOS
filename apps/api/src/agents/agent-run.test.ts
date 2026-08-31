/**
 * F2 · E1 REGRESYON TESTİ — AI ajan gözlemlenebilirliği.
 *
 * T1 çıkış kriteri: "Her AI çağrısı izlenebilir — AgentRun kaydı + iz görünümü."
 * Bu test üç taahhüdü korur:
 *  1. Katalog: her görev tipinin BİR sahibi vardır; sahipsizler GENEL'e düşer.
 *  2. İz ilkeleri: tam metin ASLA yazılmaz (KVKK), iz yazımı best-effort'tır,
 *     üç durum (BASARILI/BASARISIZ/REDDEDILDI) ayrık yazılır.
 *  3. İki LLM yürütücüsü (AiRunnerService, AssistantLlmService) izlemeye bağlıdır.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_CATALOG,
  agentCatalogForSeed,
  agentForTask,
  FALLBACK_AGENT_KEY,
} from "@nomosos/shared";
import { AI_TASK_TYPES } from "@nomosos/shared";
import { buildInputSummary, AGENT_INPUT_QUOTE_CHARS } from "./agent-run.service";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

describe("E1: ajan kataloğu — her görev tipinin bir sahibi var", () => {
  it("bir görev tipi iki ajana ait olamaz", () => {
    const seen = new Map<string, string>();
    for (const agent of AGENT_CATALOG) {
      for (const task of agent.taskTypes) {
        const owner = seen.get(task);
        expect(
          owner,
          `${task} hem ${owner} hem ${agent.agentKey} ajanına atanmış`,
        ).toBeUndefined();
        seen.set(task, agent.agentKey);
      }
    }
  });

  it("bilinen görev tipleri sahiplerini bulur; bilinmeyen GENEL'e düşer", () => {
    expect(agentForTask("CASELAW_SUMMARIZE").agentKey).toBe("ICTIHAT_ARASTIRMA");
    expect(agentForTask("PETITION_DRAFT").agentKey).toBe("DILEKCE_STUDYO");
    expect(agentForTask("BOYLE_BIR_GOREV_YOK").agentKey).toBe(FALLBACK_AGENT_KEY);
  });

  it("katalog AI_TASK_TYPES kataloğuyla çelişmez", () => {
    for (const agent of AGENT_CATALOG) {
      for (const task of agent.taskTypes) {
        expect(AI_TASK_TYPES).toContain(task);
      }
    }
  });

  it("tohum listesi GENEL dahildir (sahipsiz koşular kaybolmaz)", () => {
    expect(agentCatalogForSeed().map((a) => a.agentKey)).toContain(FALLBACK_AGENT_KEY);
  });
});

describe("E1: iz ilkeleri — KVKK ve özet sözleşmesi", () => {
  it("girdi özeti TAM METİN taşımaz: kısaltılmış ve maskeli alıntı", () => {
    // TCKN başta: alıntı penceresinin İÇİNDE kalsın; uzun kuyruk tavanı sınasın.
    // 12345678950 GEÇERLİ bir TCKN'dir (sağlama toplamı tutar) — tarama
    // yalnız geçerli kimlikleri maskeler.
    const long = "TCKN: 12345678950 " + "A".repeat(2000);
    const summary = buildInputSummary([long]);
    const parsed = JSON.parse(summary) as { parcaSayisi: number; toplamKarakter: number; alintilar: string[] };
    expect(parsed.parcaSayisi).toBe(1);
    expect(parsed.toplamKarakter).toBe(long.length);
    // Alıntı tavanı aşılmış...
    expect(parsed.alintilar[0].length).toBeLessThanOrEqual(AGENT_INPUT_QUOTE_CHARS + 1);
    // ...ve TCKN maskeli (ham kalıp kayıtta yok; maske etiketi var).
    expect(summary).not.toContain("12345678950");
    expect(summary).toContain("[TCKN-MASKELİ]");
  });

  it("çok parçalı girdi özeti en fazla 5 alıntı taşır", () => {
    const summary = buildInputSummary(Array.from({ length: 9 }, () => "metin parçası"));
    const parsed = JSON.parse(summary) as { alintilar: string[]; parcaSayisi: number };
    expect(parsed.alintilar).toHaveLength(5);
    expect(parsed.parcaSayisi).toBe(9);
  });
});

describe("E1: iki LLM yürütücüsü izlemeye bağlı", () => {
  it("AiRunnerService üç durumda da iz yazar", () => {
    const src = read("src/caselaw/ai-runner.service.ts");
    expect(src).toContain('status: "BASARISIZ"');
    expect(src).toContain('status: "REDDEDILDI"');
    expect(src).toContain('status: "BASARILI"');
    expect(src).toContain("this.agentRuns.record(");
  });

  it("AssistantLlmService koşuları izler", () => {
    const src = read("src/assistant/assistant-llm.service.ts");
    expect(src).toContain("agentRuns.record");
    expect(src).toContain('"BASARISIZ"');
    expect(src).toContain('"REDDEDILDI"');
    expect(src).toContain('"BASARILI"');
  });

  it("iz görünücü ucu kayıtlı: GET /ai/agent-runs", () => {
    const controller = read("src/agents/agent-runs.controller.ts");
    expect(controller).toContain('@Get("agent-runs")');
    const routes = read("../..//packages/shared/src/api-routes.ts").replace(/\\/g, "/");
    expect(routes).toContain('agentRuns: "/ai/agent-runs"');
  });

  it("AgentDefinition tohumu katalogdandır (iki kopya yok)", () => {
    const seed = read("../../packages/db/src/seed.ts");
    expect(seed).toContain("agentCatalogForSeed()");
    expect(seed).toContain("seedAgentDefinitions");
  });
});
