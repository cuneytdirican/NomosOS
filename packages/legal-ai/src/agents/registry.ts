/**
 * Ajan kataloğu (Modül 21).
 *
 * Ajan = tetikleyicisi, girdi sözleşmesi, çıktı şeması, kullandığı AI görev tipi
 * ve İNSAN ONAY NOKTASI açıkça tanımlı bir iş birimidir. Bu dosya, koşuyu
 * çalıştıran servisin (apps/api) tek referansıdır: hangi ajan hangi promptla
 * koşar, çıktısı hangi şemayla doğrulanır, hangi dizilerde kaynaksız bulgu
 * elenir ve sonuç insan onayına düşer mi.
 */

import type { AiTaskType } from "@nomosos/shared";
import type { ZodTypeAny } from "zod";

import type { AgentApprovalMode, AgentTrigger, AgentTriggerType, LlmMessage } from "../types";
import type { BuiltCaseContext } from "../context/case-context";
import {
  ConflictCheckOutputSchema,
  CitationVerifyOutputSchema,
  ClientStatusSummaryOutputSchema,
  DeadlineDetectOutputSchema,
  DocumentClassifyOutputSchema,
  EnforcementAnalysisOutputSchema,
  HearingPrepOutputSchema,
  RiskAssessOutputSchema,
  StrategyBuildOutputSchema,
} from "../schemas";
import {
  buildCitationVerifyMessages,
  buildClientStatusSummaryMessages,
  buildConflictCheckMessages,
  buildDeadlineDetectMessages,
  buildDocumentClassifyMessages,
  buildEnforcementAnalysisMessages,
  buildHearingPrepMessages,
  buildRiskAssessMessages,
  buildStrategyBuildMessages,
  type CitationLookupResult,
  type CitationVerifyItem,
  type RiskRuleSignal,
} from "../prompts";

/** Modül 21'deki 9 ajanın anahtarları (AgentDefinition.agent_key ile birebir). */
export const AGENT_KEYS = [
  "DOC_CLASSIFIER",
  "DEADLINE_DETECTOR",
  "HEARING_PREP",
  "ENFORCEMENT_COPILOT",
  "STRATEGY",
  "VERIFIER",
  "CLIENT_COMM",
  "CONFLICT_CHECK",
  "RISK",
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

/**
 * Ajan koşusuna verilen bağlam. Her ajan yalnızca ihtiyaç duyduğu alanları okur;
 * eksikse Türkçe hata fırlatır (veri minimizasyonu ilkesinin yan faydası).
 */
export interface AgentContext {
  /** case-context.ts ile kurulmuş, token bütçesine sığdırılmış dosya bağlamı. */
  caseContext?: BuiltCaseContext;
  /** Belge tabanlı ajanlar için ham (maskelenmiş) belge metni. */
  documentText?: string;
  documentTitle?: string;
  documentClass?: string;
  caseType?: string;
  notifiedAt?: string;
  /** Duruşma bilgileri (HEARING_PREP). */
  hearing?: { date: string; courtName: string; type?: string; purpose?: string };
  /** Teyit Ajanı girdisi. */
  citationsToVerify?: readonly CitationVerifyItem[];
  citationLookups?: readonly CitationLookupResult[];
  /** Risk Ajanı girdisi. */
  ruleSignals?: readonly RiskRuleSignal[];
  simulationFindings?: readonly string[];
  /** Conflict Check girdisi. */
  newPartyLabel?: string;
  partyIndexLines?: readonly string[];
  /** Müvekkil iletişimi girdisi. */
  channel?: "SMS" | "WHATSAPP" | "EMAIL" | "PORTAL";
  clientLabel?: string;
  /** Strateji girdisi. */
  approvedPrecedents?: readonly string[];
  existingStrategySummary?: string;
  /** İcra Copilot girdisi. */
  instruction?: string;
}

export interface AgentDefinition {
  readonly key: AgentKey;
  readonly taskType: AiTaskType;
  readonly name: string;
  readonly description: string;
  /** Birincil tetikleyici (UI kart rozeti). */
  readonly trigger: AgentTriggerType;
  /** Tüm tetikleyiciler (bir ajanın hem olay hem zamanlı tetikleyicisi olabilir). */
  readonly triggers: readonly AgentTrigger[];
  /** Çıktı insan onayı olmadan kayda dönüşebilir mi? */
  readonly requiresHumanApproval: boolean;
  readonly approvalMode: AgentApprovalMode;
  /** Tenant bu ajanı kapatabilir mi? (VERIFIER kapatılamaz — Modül 21 kural 2) */
  readonly canBeDisabled: boolean;
  /** Çıktısı içtihat/mevzuat atfı üretebilir mi? → Teyit Ajanı zorunlu geçişi. */
  readonly producesCitations: boolean;
  readonly outputSchema: ZodTypeAny;
  /** output-guard'ın kaynaksız bulgu eleyeceği dizi yolları. */
  readonly findingPaths: readonly string[];
  /** CONFIDENCE_GATED ajanlarda otomatik kabul eşiği. */
  readonly confidenceThreshold?: number;
  readonly buildMessages: (ctx: AgentContext) => LlmMessage[];
}

function requireCaseContext(ctx: AgentContext, agent: string): string {
  if (!ctx.caseContext) {
    throw new Error(`${agent} için dosya bağlamı (caseContext) zorunludur.`);
  }
  return ctx.caseContext.text;
}

function requireDocument(ctx: AgentContext, agent: string): { title: string; text: string } {
  if (!ctx.documentText) {
    throw new Error(`${agent} için belge metni (documentText) zorunludur.`);
  }
  return { title: ctx.documentTitle ?? "Adsız belge", text: ctx.documentText };
}

const AGENT_LIST: readonly AgentDefinition[] = [
  {
    key: "DOC_CLASSIFIER",
    taskType: "DOCUMENT_CLASSIFY",
    name: "Belge Sınıflandırma Ajanı",
    description:
      "UYAP senkronu, yükleme veya e-posta ekiyle düşen belgeyi taksonomiye göre sınıflar, özetler ve hukuken anlamlı tarihleri çıkarır.",
    trigger: "EVENT",
    triggers: [
      {
        type: "EVENT",
        eventKey: "document.created",
        description: "Yeni Document kaydı (UYAP sync / yükleme / e-posta eki).",
      },
    ],
    requiresHumanApproval: true,
    approvalMode: "CONFIDENCE_GATED",
    confidenceThreshold: 0.8,
    canBeDisabled: true,
    producesCitations: false,
    outputSchema: DocumentClassifyOutputSchema,
    findingPaths: ["extractedDates"],
    buildMessages: (ctx) => {
      const doc = requireDocument(ctx, "Belge Sınıflandırma Ajanı");
      return buildDocumentClassifyMessages({
        documentTitle: doc.title,
        documentText: doc.text,
        caseContextText: ctx.caseContext?.text,
      });
    },
  },
  {
    key: "DEADLINE_DETECTOR",
    taskType: "DEADLINE_DETECT",
    name: "Süre Tespit Ajanı",
    description:
      "Sınıflandırılmış karar/tebligat belgelerinde süre başlatan olayları tespit eder ve kural anahtarı önerir; son gün hesabını deterministik Süre Motoru yapar.",
    trigger: "EVENT",
    triggers: [
      {
        type: "EVENT",
        eventKey: "document.classified",
        description: "Karar/tebligat sınıfında bir belge sınıflandırıldığında.",
      },
    ],
    requiresHumanApproval: true,
    approvalMode: "MANDATORY",
    canBeDisabled: true,
    producesCitations: true,
    outputSchema: DeadlineDetectOutputSchema,
    findingPaths: ["detections"],
    buildMessages: (ctx) => {
      const doc = requireDocument(ctx, "Süre Tespit Ajanı");
      return buildDeadlineDetectMessages({
        documentText: doc.text,
        documentClass: ctx.documentClass,
        notifiedAt: ctx.notifiedAt,
        caseType: ctx.caseType,
      });
    },
  },
  {
    key: "HEARING_PREP",
    taskType: "HEARING_PREP",
    name: "Duruşma Hazırlık Ajanı",
    description:
      "Duruşma öncesi 9 sabit bölümlü hazırlık paketi üretir: özet, gelişmeler, eksik deliller, sorulacak sorular, ileri sürülecek hususlar.",
    trigger: "SCHEDULED",
    triggers: [
      { type: "MANUAL", description: "\"Duruşmalarımı hazırla\" komutu." },
      {
        type: "SCHEDULED",
        cron: "0 18 * * *",
        description: "Duruşmadan bir gün önce 18:00'de paketi olmayan duruşmalar için.",
      },
    ],
    requiresHumanApproval: false,
    approvalMode: "INFORMATIONAL",
    canBeDisabled: true,
    producesCitations: true,
    outputSchema: HearingPrepOutputSchema,
    // 9 bölüm sabittir; kaynaksız bölüm ELENMEZ, "noData/teyitsiz" olarak işaretlenir.
    findingPaths: [],
    buildMessages: (ctx) => {
      const contextText = requireCaseContext(ctx, "Duruşma Hazırlık Ajanı");
      if (!ctx.hearing) {
        throw new Error("Duruşma Hazırlık Ajanı için duruşma bilgisi (hearing) zorunludur.");
      }
      return buildHearingPrepMessages({
        hearingDate: ctx.hearing.date,
        courtName: ctx.hearing.courtName,
        hearingType: ctx.hearing.type,
        purpose: ctx.hearing.purpose,
        caseContextText: contextText,
      });
    },
  },
  {
    key: "ENFORCEMENT_COPILOT",
    taskType: "ENFORCEMENT_ANALYSIS",
    name: "İcra Copilot",
    description:
      "İcra dosyasının işlem geçmişini analiz eder; sonraki adım önerileri, kaçırılmış süre şüpheleri ve tahsilat ihtimali değerlendirmesi üretir.",
    trigger: "MANUAL",
    triggers: [
      { type: "MANUAL", description: "Dosya içi komut (\"sonraki adım ne olmalı?\")." },
      {
        type: "EVENT",
        eventKey: "enforcement.action.created",
        description: "Yeni icra işlemi kaydedildiğinde.",
      },
    ],
    requiresHumanApproval: true,
    approvalMode: "MANDATORY",
    canBeDisabled: true,
    producesCitations: true,
    outputSchema: EnforcementAnalysisOutputSchema,
    findingPaths: ["findings"],
    buildMessages: (ctx) =>
      buildEnforcementAnalysisMessages({
        caseContextText: requireCaseContext(ctx, "İcra Copilot"),
        instruction: ctx.instruction,
      }),
  },
  {
    key: "STRATEGY",
    taskType: "STRATEGY_BUILD",
    name: "Strateji Ajanı",
    description:
      "Dosya verisinden strateji ağacı taslağı (hedef, argüman, dayanak, risk, aksiyon) üretir veya mevcut stratejiye güncelleme önerir.",
    trigger: "MANUAL",
    triggers: [
      { type: "MANUAL", description: "Strateji oluştur / güncelle." },
      {
        type: "EVENT",
        eventKey: "strategy.stale",
        description: "Yeni dilekçe veya karar nedeniyle strateji bayatladığında.",
      },
    ],
    requiresHumanApproval: true,
    approvalMode: "MANDATORY",
    canBeDisabled: true,
    producesCitations: true,
    outputSchema: StrategyBuildOutputSchema,
    findingPaths: ["nodes"],
    buildMessages: (ctx) =>
      buildStrategyBuildMessages({
        caseContextText: requireCaseContext(ctx, "Strateji Ajanı"),
        approvedPrecedents: ctx.approvedPrecedents,
        existingStrategySummary: ctx.existingStrategySummary,
      }),
  },
  {
    key: "VERIFIER",
    taskType: "CITATION_VERIFY",
    name: "Teyit / Doğrulama Ajanı",
    description:
      "Atıf içeren her ajan çıktısının zorunlu ara katmanı. VERIFIED sonucu yalnızca deterministik eşleşmeyle verilir; doğrulanamayan atıf dışa dönük çıktıya aktarılamaz.",
    trigger: "EVENT",
    triggers: [
      {
        type: "EVENT",
        eventKey: "agent.output.has_citations",
        description: "Atıf üreten herhangi bir ajan çıktısı (zorunlu geçiş).",
      },
    ],
    // Onay değil KAPI: insan onayı beklemez, sonucu geçişi bloklar.
    requiresHumanApproval: false,
    approvalMode: "GATE",
    canBeDisabled: false,
    producesCitations: false,
    outputSchema: CitationVerifyOutputSchema,
    findingPaths: [],
    buildMessages: (ctx) => {
      if (!ctx.citationsToVerify || !ctx.citationLookups) {
        throw new Error(
          "Teyit Ajanı için atıf listesi (citationsToVerify) ve deterministik arama sonuçları (citationLookups) zorunludur.",
        );
      }
      return buildCitationVerifyMessages({
        citations: ctx.citationsToVerify,
        lookups: ctx.citationLookups,
      });
    },
  },
  {
    key: "CLIENT_COMM",
    taskType: "CLIENT_STATUS_SUMMARY",
    name: "Müvekkil İletişim Ajanı",
    description:
      "Dosya safahatından müvekkilin anlayacağı sade Türkçe durum özeti taslağı üretir; gönderim yalnız avukat onayıyla yapılır.",
    trigger: "MANUAL",
    triggers: [
      { type: "MANUAL", description: "\"Durum özeti hazırla\" komutu." },
      {
        type: "EVENT",
        eventKey: "case.milestone.notify",
        description: "Belge→Aksiyon hattının bilgilendirme aksiyonu.",
      },
    ],
    requiresHumanApproval: true,
    approvalMode: "MANDATORY",
    canBeDisabled: true,
    producesCitations: false,
    outputSchema: ClientStatusSummaryOutputSchema,
    findingPaths: [],
    buildMessages: (ctx) =>
      buildClientStatusSummaryMessages({
        channel: ctx.channel ?? "EMAIL",
        clientLabel: ctx.clientLabel ?? "Müvekkil",
        caseContextText: requireCaseContext(ctx, "Müvekkil İletişim Ajanı"),
      }),
  },
  {
    key: "CONFLICT_CHECK",
    taskType: "CONFLICT_INFERENCE",
    name: "Conflict Check Ajanı",
    description:
      "Yeni müvekkil/karşı taraf kaydında, deterministik eşleşmenin kaçırdığı nitel benzerlikleri (unvan varyasyonu, grup şirketi) tespit eder.",
    trigger: "EVENT",
    triggers: [
      {
        type: "EVENT",
        eventKey: "party.created",
        description: "Yeni Client veya karşı taraf kaydı.",
      },
      { type: "MANUAL", description: "Elle çatışma taraması." },
    ],
    requiresHumanApproval: true,
    approvalMode: "MANDATORY",
    canBeDisabled: true,
    producesCitations: false,
    outputSchema: ConflictCheckOutputSchema,
    findingPaths: ["matches"],
    buildMessages: (ctx) => {
      if (!ctx.newPartyLabel) {
        throw new Error("Conflict Check Ajanı için yeni taraf bilgisi (newPartyLabel) zorunludur.");
      }
      return buildConflictCheckMessages({
        newPartyLabel: ctx.newPartyLabel,
        partyIndexLines: ctx.partyIndexLines ?? [],
      });
    },
  },
  {
    key: "RISK",
    taskType: "RISK_ASSESS",
    name: "Risk Ajanı",
    description:
      "Kural tabanlı risk sinyallerinin yakalayamadığı nitel riskleri boyut başına ±25 sınırlı düzeltmeyle puanlar ve gerekçelendirir.",
    trigger: "SCHEDULED",
    triggers: [
      { type: "SCHEDULED", cron: "0 3 * * *", description: "Her gece 03:00 tenant koşusu." },
      {
        type: "EVENT",
        eventKey: "case.risk.signal_changed",
        description: "Süre / belge / duruşma / finans değişikliği.",
      },
    ],
    // Skor otomatik yazılır (±25 sınırlı); avukatın gerekçeli override hakkı saklıdır.
    requiresHumanApproval: false,
    approvalMode: "INFORMATIONAL",
    canBeDisabled: true,
    producesCitations: false,
    outputSchema: RiskAssessOutputSchema,
    findingPaths: ["adjustments"],
    buildMessages: (ctx) =>
      buildRiskAssessMessages({
        ruleSignals: ctx.ruleSignals ?? [],
        caseContextText: requireCaseContext(ctx, "Risk Ajanı"),
        simulationFindings: ctx.simulationFindings,
      }),
  },
];

export const AGENT_REGISTRY: Readonly<Record<AgentKey, AgentDefinition>> = Object.freeze(
  AGENT_LIST.reduce<Record<AgentKey, AgentDefinition>>(
    (acc, agent) => {
      acc[agent.key] = agent;
      return acc;
    },
    {} as Record<AgentKey, AgentDefinition>,
  ),
);

/** Katalogdaki tüm ajanlar (UI'daki Ajan Merkezi kartları için). */
export function listAgents(): readonly AgentDefinition[] {
  return AGENT_LIST;
}

/** Anahtardan ajan tanımı; bilinmeyen anahtarda Türkçe hata. */
export function getAgent(key: string): AgentDefinition {
  const agent = AGENT_REGISTRY[key as AgentKey];
  if (!agent) {
    throw new Error(`Bilinmeyen ajan anahtarı: ${key}`);
  }
  return agent;
}

/** Belirli bir olay anahtarını dinleyen ajanlar. */
export function agentsForEvent(eventKey: string): readonly AgentDefinition[] {
  return AGENT_LIST.filter((a) =>
    a.triggers.some((t) => t.type === "EVENT" && t.eventKey === eventKey),
  );
}

/** Zamanlı koşan ajanlar. */
export function scheduledAgents(): readonly AgentDefinition[] {
  return AGENT_LIST.filter((a) => a.triggers.some((t) => t.type === "SCHEDULED"));
}
