/**
 * F2 · E1 — AI AJAN KATALOĞU (tek kaynak).
 *
 * Her AI görev tipinin SAHİBİ bir ajandır: iz görünümü "CASELAW_SUMMARIZE —
 * 213 ms" demez, "İçtihat Araştırma ajanı bu dosyayı özetledi" der. Katalog
 * aynı zamanda `AgentDefinition` tablosunun tohum kaynağıdır (DeadlineRule
 * deseni: iki yerde elle kopya tutulmaz).
 *
 * Bir görev tipi burada yoksa koşu izi bilinmeyen anahtarla DEĞİL, `GENEL`
 * ajanı altında yazılır — katalog eksikliği izin KAYBINA yol açmaz.
 */

import { AI_TASK_TYPE_LABELS, type AiTaskType } from "./ai-task-types";

export interface AgentCatalogEntry {
  agentKey: string;
  taskTypes: readonly AiTaskType[];
  name: string;
  description: string;
}

export const AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  {
    agentKey: "DOSYA_ASISTANI",
    taskTypes: ["CASE_CHAT", "CASE_FULL_ANALYSIS", "SMART_NOTE", "OFFICE_QUERY", "DAILY_PRIORITIZE"],
    name: "Dosya Asistanı",
    description: "Dosya sohbeti, tam analiz, akıllı not ve büro sorguları (Modül 24).",
  },
  {
    agentKey: "BELGE_HATTI",
    taskTypes: ["EMBEDDING", "DOCUMENT_CLASSIFY", "DOCUMENT_EXTRACT", "DEADLINE_DETECT"],
    name: "Belge → Aksiyon Hattı",
    description: "Yüklenen belgeyi sınıflandırır, veri çıkarır ve süre önerir (Modül 06).",
  },
  {
    agentKey: "DURUSMA_HAZIRLIK",
    taskTypes: ["HEARING_PREP"],
    name: "Duruşma Hazırlığı",
    description: "Duruşma öncesi dosya özeti ve soru listesi (Modül 03).",
  },
  {
    agentKey: "ICRA_COPILOT",
    taskTypes: ["ENFORCEMENT_ANALYSIS", "COLLECTION_LIKELIHOOD"],
    name: "İcra Copilot",
    description: "İcra dosyası analizi ve tahsilat ihtimali değerlendirmesi (Modül 05).",
  },
  {
    agentKey: "DILEKCE_STUDYO",
    taskTypes: ["PETITION_DRAFT", "PETITION_SECTION_REWRITE"],
    name: "Dilekçe Stüdyosu",
    description: "Bölüm bölüm dilekçe taslağı üretimi ve yeniden yazım (Modül 22).",
  },
  {
    agentKey: "ICTIHAT_ARASTIRMA",
    taskTypes: ["CASELAW_SEARCH", "CASELAW_SUMMARIZE", "CITATION_VERIFY"],
    name: "İçtihat Araştırma",
    description: "Sorgu genişletme, karar özetleme ve atıf teyidi (Modül 23).",
  },
  {
    agentKey: "MUVEKKIL_ILETISIM",
    taskTypes: ["CLIENT_STATUS_SUMMARY", "MESSAGE_DRAFT", "MESSAGE_CASE_MATCH"],
    name: "Müvekkil İletişimi",
    description: "Durum özeti, mesaj taslağı ve gelen mesaj eşleştirme (Modül 10/19).",
  },
  {
    agentKey: "CAKISMA_KONTROL",
    taskTypes: ["CONFLICT_INFERENCE"],
    name: "Çıkar Çatışması Kontrolü",
    description: "Taraf adlarından çıkar çatışması çıkarımı (Modül 11).",
  },
  {
    agentKey: "VEKALETNAME",
    taskTypes: ["POA_SCOPE_ANALYSIS"],
    name: "Vekaletname Kapsam Analizi",
    description: "Vekaletname metninden kapsam çıkarımı (Modül 12).",
  },
  {
    agentKey: "BILIRKISI",
    taskTypes: ["EXPERT_REPORT_DIFF"],
    name: "Bilirkişi Karşılaştırma",
    description: "İki bilirkişi raporu arasındaki farklar (Modül 13).",
  },
  {
    agentKey: "DELIL_MATRIS",
    taskTypes: ["EVIDENCE_MATRIX", "EVIDENCE_GAP"],
    name: "Delil Matrisi",
    description: "İddia × delil matrisi ve boşluk analizi (Modül 14).",
  },
  {
    agentKey: "STRATEJI_SIMULASYON",
    taskTypes: ["STRATEGY_BUILD", "OPPONENT_SIMULATION", "JUDGE_SIMULATION"],
    name: "Strateji ve Simülasyon",
    description: "Strateji kurma ve taraf/hakim simülasyonları (Modül 15/16).",
  },
  {
    agentKey: "RISK_DEGERLENDIRME",
    taskTypes: ["RISK_ASSESS"],
    name: "Risk Değerlendirmesi",
    description: "Yedi boyutlu risk değerlendirmesine sınırlı AI düzeltmesi (Modül 17).",
  },
  {
    agentKey: "FINANS_OZET",
    taskTypes: ["CLIENT_FINANCIAL_SUMMARY"],
    name: "Müvekkil Finans Özeti",
    description: "Müvekkil finansal durum özeti (Modül 08).",
  },
  {
    agentKey: "SOZLESME_INCELEME",
    taskTypes: ["CONTRACT_REVIEW"],
    name: "Sözleşme İnceleme",
    description: "Sözleşme risk işaretleme (Modül 20).",
  },
  {
    agentKey: "RAPOR_YORUM",
    taskTypes: ["REPORT_INTERPRET"],
    name: "Rapor Yorumu",
    description: "Deterministik rapor rakamlarının Türkçe anlatımı (Modül 26).",
  },
] as const;

/** Katalogda tanımsız görev tiplerinin düştüğü ajan. */
export const FALLBACK_AGENT_KEY = "GENEL";
const FALLBACK_AGENT: AgentCatalogEntry = {
  agentKey: FALLBACK_AGENT_KEY,
  taskTypes: [],
  name: "Genel",
  description: "Katalogda sahibi tanımlanmamış görev tiplerinin koşuları.",
};

const AGENT_BY_TASK = new Map<string, AgentCatalogEntry>(
  AGENT_CATALOG.flatMap((agent) => agent.taskTypes.map((t) => [t, agent] as const)),
);

/** Görev tipinin sahibi ajan; katalogda yoksa GENEL ajanı. */
export function agentForTask(taskType: string): AgentCatalogEntry {
  return AGENT_BY_TASK.get(taskType) ?? FALLBACK_AGENT;
}

/** Katalogdakiler + GENEL — AgentDefinition tohumunun kaynağı. */
export function agentCatalogForSeed(): AgentCatalogEntry[] {
  return [...AGENT_CATALOG, FALLBACK_AGENT];
}

/** İnsan-okur görev etiketi (AI_TASK_TYPE_LABELS güvencesiyle). */
export function taskTypeLabel(taskType: string): string {
  return AI_TASK_TYPE_LABELS[taskType as AiTaskType] ?? taskType;
}
