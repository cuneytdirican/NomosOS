import { describe, expect, it } from "vitest";

import { AI_TASK_TYPES } from "@nomosos/shared";

import {
  AGENT_KEYS,
  agentsForEvent,
  getAgent,
  listAgents,
  scheduledAgents,
} from "../agents/registry";
import { buildCaseContext } from "../context/case-context";
import { getPromptSpec, NOMOSOS_SYSTEM_CORE_PROMPT } from "../prompts";

const CASE_CONTEXT = buildCaseContext(
  {
    piiScanned: true,
    case: { caseNumber: "2026/145", courtName: "İstanbul 12. İş Mahkemesi" },
    timeline: [{ date: "2026-08-12", description: "Ara karar tebliğ edildi." }],
  },
  { tokenBudget: 2000 },
);

describe("ajan kataloğu", () => {
  it("Modül 21'deki 9 ajanı eksiksiz içerir", () => {
    expect(AGENT_KEYS).toHaveLength(9);
    expect(listAgents()).toHaveLength(9);
    for (const key of AGENT_KEYS) {
      expect(getAgent(key).key).toBe(key);
    }
    expect(() => getAgent("YOK_BOYLE_BIR_AJAN")).toThrow(/Bilinmeyen ajan/i);
  });

  it("her ajanın görev tipi AI_TASK_TYPES kataloğunda tanımlıdır", () => {
    for (const agent of listAgents()) {
      expect(AI_TASK_TYPES).toContain(agent.taskType);
      expect(() => getPromptSpec(agent.taskType)).not.toThrow();
      expect(getPromptSpec(agent.taskType).taskType).toBe(agent.taskType);
    }
  });

  it("her ajanın tetikleyicisi, onay modeli ve çıktı şeması doludur", () => {
    for (const agent of listAgents()) {
      expect(agent.triggers.length).toBeGreaterThan(0);
      expect(agent.triggers.some((t) => t.type === agent.trigger)).toBe(true);
      expect(agent.approvalMode).toBeTruthy();
      expect(agent.outputSchema).toBeTruthy();
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.description.length).toBeGreaterThan(0);
    }
  });

  it("Süre Tespit Ajanı zorunlu onaya tabidir ve kaynaksız tespitleri elenir", () => {
    const agent = getAgent("DEADLINE_DETECTOR");
    expect(agent.requiresHumanApproval).toBe(true);
    expect(agent.approvalMode).toBe("MANDATORY");
    expect(agent.findingPaths).toContain("detections");
  });

  it("Teyit Ajanı bir kapıdır ve tenant tarafından kapatılamaz", () => {
    const verifier = getAgent("VERIFIER");
    expect(verifier.approvalMode).toBe("GATE");
    expect(verifier.canBeDisabled).toBe(false);
    expect(listAgents().filter((a) => !a.canBeDisabled).map((a) => a.key)).toEqual(["VERIFIER"]);
  });

  it("olay ve zamanlı tetikleyicilerden ajanları bulur", () => {
    expect(agentsForEvent("document.created").map((a) => a.key)).toEqual(["DOC_CLASSIFIER"]);
    expect(agentsForEvent("document.classified").map((a) => a.key)).toEqual(["DEADLINE_DETECTOR"]);
    expect(scheduledAgents().map((a) => a.key).sort()).toEqual(["HEARING_PREP", "RISK"]);
    expect(agentsForEvent("olmayan.olay")).toHaveLength(0);
  });

  it("buildMessages çekirdek sistem promptunu ve kullanıcı içeriğini üretir", () => {
    const messages = getAgent("RISK").buildMessages({
      caseContext: CASE_CONTEXT,
      ruleSignals: [{ dimension: "DEADLINE", description: "Süre yaklaşıyor", points: 40 }],
    });

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain(NOMOSOS_SYSTEM_CORE_PROMPT);
    expect(messages[messages.length - 1].role).toBe("user");
    expect(messages[messages.length - 1].content).toContain("2026/145");
  });

  it("eksik bağlamda Türkçe hata fırlatır (veri sözleşmesi ihlali sessiz geçmez)", () => {
    expect(() => getAgent("HEARING_PREP").buildMessages({})).toThrow(/dosya bağlamı/i);
    expect(() => getAgent("DOC_CLASSIFIER").buildMessages({})).toThrow(/belge metni/i);
    expect(() => getAgent("VERIFIER").buildMessages({})).toThrow(/atıf listesi/i);
  });
});
