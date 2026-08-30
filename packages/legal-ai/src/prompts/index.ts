/** Prompt katmanı dışa aktarımları + görev tipi → PromptSpec kataloğu. */

import type { AiTaskType } from "@nomosos/shared";
import type { PromptSpec } from "../types";

import { documentClassifyPrompt } from "./document-classify";
import { deadlineDetectPrompt } from "./deadline-detect";
import { hearingPrepPrompt } from "./hearing-prep";
import { caseChatPrompt } from "./case-chat";
import { petitionDraftPrompt } from "./petition-draft";
import { citationVerifyPrompt } from "./citation-verify";
import { opponentSimulationPrompt } from "./opponent-simulation";
import { riskAssessPrompt } from "./risk-assess";
import { clientStatusSummaryPrompt } from "./client-status-summary";
import { enforcementAnalysisPrompt } from "./enforcement-analysis";
import { strategyBuildPrompt } from "./strategy-build";
import { conflictCheckPrompt } from "./conflict-check";

export * from "./system-core";
export * from "./document-classify";
export * from "./deadline-detect";
export * from "./hearing-prep";
export * from "./case-chat";
export * from "./petition-draft";
export * from "./citation-verify";
export * from "./opponent-simulation";
export * from "./risk-assess";
export * from "./client-status-summary";
export * from "./enforcement-analysis";
export * from "./strategy-build";
export * from "./conflict-check";

/** Görev tipi → prompt sözleşmesi. BYO-LLM model eşlemesi aynı anahtarı kullanır. */
export const PROMPT_REGISTRY: Partial<Record<AiTaskType, PromptSpec>> = {
  DOCUMENT_CLASSIFY: documentClassifyPrompt,
  DEADLINE_DETECT: deadlineDetectPrompt,
  HEARING_PREP: hearingPrepPrompt,
  CASE_CHAT: caseChatPrompt,
  PETITION_DRAFT: petitionDraftPrompt,
  CITATION_VERIFY: citationVerifyPrompt,
  OPPONENT_SIMULATION: opponentSimulationPrompt,
  RISK_ASSESS: riskAssessPrompt,
  CLIENT_STATUS_SUMMARY: clientStatusSummaryPrompt,
  ENFORCEMENT_ANALYSIS: enforcementAnalysisPrompt,
  STRATEGY_BUILD: strategyBuildPrompt,
  CONFLICT_INFERENCE: conflictCheckPrompt,
};

/** Görev tipine karşılık gelen prompt; tanımsızsa Türkçe hata fırlatır. */
export function getPromptSpec(taskType: AiTaskType): PromptSpec {
  const spec = PROMPT_REGISTRY[taskType];
  if (!spec) {
    throw new Error(`Bu AI görev tipi için tanımlı bir prompt bulunamadı: ${taskType}`);
  }
  return spec;
}
