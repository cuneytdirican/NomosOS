/**
 * Hukuki AI görevlerinin ÇIKTI şemaları (zod).
 *
 * Bu şemalar tek gerçeklik kaynağıdır: prompt metninde tarif edilen JSON,
 * output-guard'ın doğruladığı JSON ve API'nin sakladığı JSON aynı şemadır.
 * Şemalarda kaynak alanları (sourceQuote / sourceRefs / citations) bilinçli
 * olarak OPSİYONELDİR: kaynaksız bulguyu şema reddetmez, guard ELER —
 * böylece tek bir kaynaksız bulgu yüzünden koşunun tamamı çöpe gitmez.
 */

import { z } from "zod";
import { DOCUMENT_CLASSES } from "@nomosos/shared";
import { SYSTEM_DEADLINE_RULE_KEYS } from "@nomosos/legal-core";

/** ISO 8601 tarih (YYYY-MM-DD). */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır.");

/** 0..1 arası güven skoru. */
export const ConfidenceSchema = z.number().min(0).max(1);

/** Bir bulgunun dayandığı belge konumu. */
export const SourceRefSchema = z.object({
  // sayfa/paragraf 0 GEÇERLİDİR: model 0-indeksli sayfa verebilir (canlı
  // bulgu: page=0 reddedilip tüm simülasyon koşusu çöpe gidiyordu).
  // Faz 1 canlı bulgusu (Gemma 4, HEARING_PREP): küçük yerel modeller sayfa/paragraf
  // bilmediğinde `null` yazar; tek bir null tüm paketi şema reddine düşürüyordu.
  // null = "yok" sayılır (ChatCitationSchema ile aynı tolerans).
  page: z.number().int().min(0).nullable().optional().transform((v) => v ?? undefined),
  paragraph: z.number().int().min(0).nullable().optional().transform((v) => v ?? undefined),
  quote: z.string().nullable().optional().transform((v) => v ?? undefined),
  documentId: z.string().nullable().optional().transform((v) => v ?? undefined),
  documentTitle: z.string().nullable().optional().transform((v) => v ?? undefined),
});
export type SourceRefOutput = z.infer<typeof SourceRefSchema>;

/** LLM çıktısında geçen ham atıf. */
export const CitationSchema = z.object({
  kind: z.enum(["ICTIHAT", "MEVZUAT"]),
  raw: z.string().min(1),
  source: z.enum(["YARGITAY", "DANISTAY", "BAM", "AYM", "AIHM", "BILINMIYOR"]).optional(),
  chamber: z.string().optional(),
  esasNo: z.string().optional(),
  kararNo: z.string().optional(),
  statuteRef: z.string().optional(),
  articleNo: z.string().optional(),
});
export type CitationOutput = z.infer<typeof CitationSchema>;

/* ------------------------------------------------------------------ *
 * 1) DOCUMENT_CLASSIFY — Belge Sınıflandırma Ajanı
 * ------------------------------------------------------------------ */

export const ExtractedDateSchema = z.object({
  /** "Tebliğ tarihi", "Karar tarihi", "Duruşma tarihi" gibi etiket. */
  label: z.string().min(1),
  date: IsoDateSchema,
  sourceQuote: z.string().optional(),
});

export const DocumentClassifyOutputSchema = z.object({
  class: z.enum(DOCUMENT_CLASSES),
  confidence: ConfidenceSchema,
  reasoning: z.string().min(1),
  summary: z.string().min(1),
  extractedDates: z.array(ExtractedDateSchema).default([]),
  /** Belgede geçen dosya/esas numarası önerisi (dosya bağlama için). */
  suggestedCaseNumber: z.string().optional(),
  courtName: z.string().optional(),
  /** Sınıflandırma belirsizse avukata sorulacak soru. */
  uncertaintyNote: z.string().optional(),
});
export type DocumentClassifyOutput = z.infer<typeof DocumentClassifyOutputSchema>;

/* ------------------------------------------------------------------ *
 * 2) DEADLINE_DETECT — Süre Tespit Ajanı (hesaplama YAPMAZ)
 * ------------------------------------------------------------------ */

/**
 * Kural anahtarı belirlenemediğinde kullanılacak AÇIK işaretçi.
 *
 * Model "en yakın kuralı" uydurmak yerine bunu yazar; koşu düşmez ama tespit
 * deterministik motora bağlanmadan AVUKAT SEÇİMİNE düşer.
 */
export const UNKNOWN_DEADLINE_RULE_KEY = "BELIRSIZ";

/**
 * Süre Motoru'nun TANIDIĞI kural anahtarları — tek kaynak `@nomosos/legal-core`.
 *
 * DÜZELTİLDİ (hukuki denetim, bulgu 2): prompt `HMK_281_BILIRKISI_ITIRAZ`,
 * `HMK_341_ISTINAF`, `HMK_120_HARC_TAMAMLAMA` gibi motorda BULUNMAYAN anahtarlar
 * öğretiyordu; şema da yalnız `z.string().min(1)` istediği için bunlar sessizce
 * geçiyordu. Sonuç: ya tüm tespitler düşer ya da "en yakın kural"a bağlanıp YANLIŞ
 * süre hesaplanırdı. Artık liste motordan türetilir, prompt'a enjekte edilir ve
 * bilinmeyen anahtar AÇIK HATA olur (sessiz eşleşme asla).
 */
export const DEADLINE_RULE_KEYS: readonly string[] = [
  ...SYSTEM_DEADLINE_RULE_KEYS,
  UNKNOWN_DEADLINE_RULE_KEY,
];

const DEADLINE_RULE_KEY_SET = new Set(DEADLINE_RULE_KEYS);

/** Anahtar deterministik motorda tanımlı mı? (`BELIRSIZ` dâhil) */
export function isKnownDeadlineRuleKey(key: string): boolean {
  return DEADLINE_RULE_KEY_SET.has(key);
}

export const DeadlineRuleKeySchema = z
  .string()
  .min(1)
  .refine(isKnownDeadlineRuleKey, (key) => ({
    message:
      `Bilinmeyen süre kuralı anahtarı: "${key}". Anahtar deterministik Süre Motoru ` +
      `(@nomosos/legal-core) kural setinde bulunmalıdır; belirlenemiyorsa "${UNKNOWN_DEADLINE_RULE_KEY}" kullanılır.`,
  }));

export const DeadlineDetectionSchema = z.object({
  /** "Bilirkişi raporuna itiraz süresi başlatan tebliğ" gibi olay tarifi. */
  eventDescription: z.string().min(1),
  /** Süreyi başlatan olayın tarihi (tebliğ/tefhim/karar tarihi). */
  eventDate: IsoDateSchema,
  /** Deterministik süre motorundaki kural anahtarı (örn. HMK_BILIRKISI_ITIRAZ). */
  suggestedRuleKey: DeadlineRuleKeySchema,
  /** Kuralın mevzuat dayanağı — bağlamda/metinde geçiyorsa. */
  statuteBasis: z.string().optional(),
  confidence: ConfidenceSchema,
  /** Belgeden birebir alıntı — kaynaksız tespit elenir. */
  sourceQuote: z.string().optional(),
  sourceRefs: z.array(SourceRefSchema).optional(),
});
export type DeadlineDetection = z.infer<typeof DeadlineDetectionSchema>;

export const DeadlineDetectOutputSchema = z.object({
  detections: z.array(DeadlineDetectionSchema).default([]),
  /** Tespit yoksa veya belge süre doğurmuyorsa açıklama. */
  notes: z.string().optional(),
});
export type DeadlineDetectOutput = z.infer<typeof DeadlineDetectOutputSchema>;

/* ------------------------------------------------------------------ *
 * 3) HEARING_PREP — Duruşma Hazırlık Ajanı (9 SABİT bölüm)
 * ------------------------------------------------------------------ */

/** Modül 03'teki sabit bölüm sözleşmesi; UI ve yazdırma şablonu buna kodludur. */
export const HEARING_PREP_SECTION_KEYS = [
  "case_summary",
  "recent_events",
  "opponent_last_statement",
  "last_decision",
  "missing_evidence",
  "questions_to_ask",
  "points_to_raise",
  "deadlines",
  "previous_minutes",
] as const;
export type HearingPrepSectionKey = (typeof HEARING_PREP_SECTION_KEYS)[number];

export const HEARING_PREP_SECTION_TITLES: Record<HearingPrepSectionKey, string> = {
  case_summary: "Dosya Özeti",
  recent_events: "Son Gelişmeler",
  opponent_last_statement: "Karşı Tarafın Son Beyanı",
  last_decision: "Son Karar / Ara Karar",
  missing_evidence: "Eksik Deliller",
  questions_to_ask: "Sorulacak Sorular",
  points_to_raise: "İleri Sürülecek Hususlar",
  deadlines: "Açık Süreler",
  previous_minutes: "Önceki Celse Tutanağı",
};

export const HearingPrepSectionSchema = z.object({
  content: z.string(),
  bullets: z.array(z.string()).default([]),
  sourceRefs: z.array(SourceRefSchema).default([]),
  /** Bölüm için bağlamda veri yoksa true; içerik "bağlamda yok" kalıbı olur. */
  noData: z.boolean().default(false),
});

export const HearingPrepOutputSchema = z.object({
  sections: z.object({
    case_summary: HearingPrepSectionSchema,
    recent_events: HearingPrepSectionSchema,
    opponent_last_statement: HearingPrepSectionSchema,
    last_decision: HearingPrepSectionSchema,
    missing_evidence: HearingPrepSectionSchema,
    questions_to_ask: HearingPrepSectionSchema,
    points_to_raise: HearingPrepSectionSchema,
    deadlines: HearingPrepSectionSchema,
    previous_minutes: HearingPrepSectionSchema,
  }),
});
export type HearingPrepOutput = z.infer<typeof HearingPrepOutputSchema>;

/* ------------------------------------------------------------------ *
 * 4) CASE_CHAT — Dosya Sohbeti
 * ------------------------------------------------------------------ */

export const ChatCitationSchema = z.object({
  kind: z.enum(["DOCUMENT", "TIMELINE", "DEADLINE", "CASELAW", "STATUTE"]),
  refId: z.string().optional(),
  chunkId: z.string().optional(),
  // 0-indeksli sayfa geçerli (bkz. SourceRefSchema). Küçük yerel modeller sayfa
  // bilmediğinde `null` yazar (canlı bulgu, Gemma 4): null "yok" sayılır, tüm
  // yanıt şema reddine düşmez.
  page: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .transform((v) => v ?? undefined),
  /** Cevabı destekleyen birebir alıntı. */
  quote: z.string().nullable().optional().transform((v) => v ?? undefined),
  label: z.string().min(1),
});

export const CaseChatOutputSchema = z.object({
  answer: z.string().min(1),
  citations: z.array(ChatCitationSchema).default([]),
  /** Bağlamda cevap bulunamadıysa true; cevap "dosyada rastlamadım" kalıbıdır. */
  noSource: z.boolean().default(false),
  followUpSuggestions: z.array(z.string()).default([]),
});
export type CaseChatOutput = z.infer<typeof CaseChatOutputSchema>;

/* ------------------------------------------------------------------ *
 * 5) PETITION_DRAFT — Dilekçe Taslağı
 * ------------------------------------------------------------------ */

export const PetitionSectionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  origin: z.enum(["AI", "MANUAL", "TEMPLATE"]).default("AI"),
});

export const PetitionDraftOutputSchema = z.object({
  sections: z.array(PetitionSectionSchema).min(1),
  /** Metinde kullanılan atıflar — hepsi teyit kapısından geçer. */
  citations: z.array(CitationSchema).default([]),
  /**
   * Bağlamda emsal yoksa uydurmak yerine bırakılan işaretçiler.
   * Metinde "[EMSAL ÖNERİSİ: ...]" olarak da görünür.
   */
  precedentSuggestions: z.array(z.string()).default([]),
  /** Bağlamda eksik olduğu için doldurulamayan alanlar. */
  missingContextNotes: z.array(z.string()).default([]),
});
export type PetitionDraftOutput = z.infer<typeof PetitionDraftOutputSchema>;

/* ------------------------------------------------------------------ *
 * 6) CITATION_VERIFY — Teyit Ajanı
 * ------------------------------------------------------------------ */

export const CITATION_VERIFY_STATUSES = ["VERIFIED", "NOT_FOUND", "AMBIGUOUS"] as const;
export type CitationVerifyStatus = (typeof CITATION_VERIFY_STATUSES)[number];

/**
 * DÜZELTİLDİ (hukuki denetim, bulgu 4): `VERIFIED` statüsü DETERMİNİSTİK EŞLEŞMEYE
 * bağlanmamıştı. Şema eşleşme kimliğini opsiyonel bıraktığı ve guard ek kontrol
 * yapmadığı için modelin `{"status":"VERIFIED","note":"..."}` demesi, kapatılamayan
 * (`canBeDisabled:false`, `approvalMode:"GATE"`) TEK halüsinasyon kapısını geçiyordu;
 * uydurma künye dilekçeye/UYAP'a gidebilirdi.
 *
 * Artık `VERIFIED` yalnızca bir eşleşme kimliği (karar veya mevzuat sürümü) ile
 * birlikte geçerlidir. İkinci kapı koşum zamanındadır: `enforceCitationLookups`
 * (guards/output-guard.ts) arama sonucu FOUND değilse statüyü AMBIGUOUS'a düşürür.
 */
export const VerifiedCitationSchema = z
  .object({
    raw: z.string().min(1),
    status: z.enum(CITATION_VERIFY_STATUSES),
    /** Deterministik eşleşmede havuzdaki karar kimliği. */
    matchedCaseLawId: z.string().min(1).optional(),
    matchedStatuteVersionId: z.string().min(1).optional(),
    /** Kaynak metin ile önermenin uyumu (kaynak metin verildiyse). */
    verdict: z.enum(["SUPPORTS", "PARTIAL", "CONTRADICTS", "UNRELATED"]).optional(),
    note: z.string().min(1),
  })
  .superRefine((citation, ctx) => {
    if (citation.status !== "VERIFIED") return;
    if (!citation.matchedCaseLawId && !citation.matchedStatuteVersionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "VERIFIED statüsü yalnızca deterministik eşleşmeyle verilebilir: " +
          "matchedCaseLawId veya matchedStatuteVersionId zorunludur.",
      });
    }
  });
export type VerifiedCitation = z.infer<typeof VerifiedCitationSchema>;

export const CitationVerifyOutputSchema = z.object({
  citations: z.array(VerifiedCitationSchema).default([]),
  /** PASSED: hepsi VERIFIED · PARTIAL: en az biri değil · FAILED: hiçbiri değil. */
  overallStatus: z.enum(["PASSED", "PARTIAL", "FAILED"]),
});
export type CitationVerifyOutput = z.infer<typeof CitationVerifyOutputSchema>;

/* ------------------------------------------------------------------ *
 * 7) OPPONENT_SIMULATION — Karşı Taraf Avukatı Simülasyonu
 * ------------------------------------------------------------------ */

export const OpponentArgumentSchema = z.object({
  rank: z.number().int().positive(),
  title: z.string().min(1),
  basis: z.string().min(1),
  strength: z.number().int().min(1).max(10),
  /** "Bizim açığımız" — savunmamızdaki zayıf nokta. */
  ourGap: z.string().min(1),
  suggestedReply: z.string().min(1),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  citations: z.array(CitationSchema).default([]),
  sourceRefs: z.array(SourceRefSchema).optional(),
});

export const OpponentSimulationOutputSchema = z.object({
  arguments: z.array(OpponentArgumentSchema).default([]),
  overallAssessment: z.string().optional(),
});
export type OpponentSimulationOutput = z.infer<typeof OpponentSimulationOutputSchema>;

/* ------------------------------------------------------------------ *
 * 8) RISK_ASSESS — Risk Ajanı
 * ------------------------------------------------------------------ */

export const RISK_DIMENSIONS = [
  "LEGAL",
  "DEADLINE",
  "EVIDENCE",
  "COLLECTION",
  "PROCEDURE",
  "PRECEDENT",
  "OPPONENT",
] as const;
export type RiskDimension = (typeof RISK_DIMENSIONS)[number];

export const RISK_DIMENSION_LABELS: Record<RiskDimension, string> = {
  LEGAL: "Hukuki Risk",
  DEADLINE: "Süre Riski",
  EVIDENCE: "Delil Riski",
  COLLECTION: "Tahsilat Riski",
  PROCEDURE: "Usul Riski",
  PRECEDENT: "İçtihat Riski",
  OPPONENT: "Karşı Taraf Riski",
};

export const RiskAdjustmentSchema = z.object({
  dimension: z.enum(RISK_DIMENSIONS),
  /** Kural tabanına eklenen düzeltme; ±25 ile sınırlıdır. */
  adjustment: z.number().int().min(-25).max(25),
  reason: z.string().min(1),
  sourceRefs: z.array(SourceRefSchema).optional(),
});

export const RiskAssessOutputSchema = z.object({
  adjustments: z.array(RiskAdjustmentSchema).default([]),
  /** Hiçbir boyutta veri yoksa açıklama. */
  notes: z.string().optional(),
});
export type RiskAssessOutput = z.infer<typeof RiskAssessOutputSchema>;

/* ------------------------------------------------------------------ *
 * 9) CLIENT_STATUS_SUMMARY — Müvekkil İletişim Ajanı
 * ------------------------------------------------------------------ */

export const ClientStatusSummaryOutputSchema = z.object({
  /** Müvekkile gönderilecek taslak metin (sade Türkçe). */
  message: z.string().min(1),
  /** Kaçınılmaz hukuki terimlerin tek cümlelik açıklamaları. */
  glossary: z
    .array(z.object({ term: z.string().min(1), explanation: z.string().min(1) }))
    .default([]),
  /** Müvekkilden beklenen aksiyon varsa. */
  nextStepForClient: z.string().optional(),
  sourceRefs: z.array(SourceRefSchema).optional(),
});
export type ClientStatusSummaryOutput = z.infer<typeof ClientStatusSummaryOutputSchema>;

/* ------------------------------------------------------------------ *
 * 10) ENFORCEMENT_ANALYSIS — İcra Copilot
 * ------------------------------------------------------------------ */

export const EnforcementFindingSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  kind: z.enum(["SONRAKI_ADIM", "KACIRILAN_SURE", "ITIRAZ", "MALVARLIGI", "DIGER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  sourceQuote: z.string().optional(),
  sourceRefs: z.array(SourceRefSchema).optional(),
});

export const EnforcementAnalysisOutputSchema = z.object({
  findings: z.array(EnforcementFindingSchema).default([]),
  /** 0..1; dayanağı olmadan verilmez. */
  collectionLikelihood: ConfidenceSchema.optional(),
  collectionReasoning: z.string().optional(),
});
export type EnforcementAnalysisOutput = z.infer<typeof EnforcementAnalysisOutputSchema>;

/* ------------------------------------------------------------------ *
 * 11) STRATEGY_BUILD — Strateji Ajanı
 * ------------------------------------------------------------------ */

export const StrategyNodeSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["HEDEF", "ARGUMAN", "DAYANAK", "RISK", "AKSIYON"]),
  detail: z.string().min(1),
  citations: z.array(CitationSchema).default([]),
  sourceRefs: z.array(SourceRefSchema).optional(),
});

export const StrategyBuildOutputSchema = z.object({
  nodes: z.array(StrategyNodeSchema).default([]),
  summary: z.string().optional(),
});
export type StrategyBuildOutput = z.infer<typeof StrategyBuildOutputSchema>;

/* ------------------------------------------------------------------ *
 * 12) CONFLICT_INFERENCE — Conflict Check Ajanı
 * ------------------------------------------------------------------ */

export const ConflictMatchSchema = z.object({
  matchType: z.enum(["AYNI_KISI", "BENZER_UNVAN", "ILISKILI_SIRKET", "KARSI_TARAF", "DIGER"]),
  recordRef: z.string().min(1),
  similarityReason: z.string().min(1),
  severity: z.enum(["YESIL", "SARI", "KIRMIZI"]),
  sourceQuote: z.string().optional(),
});

export const ConflictCheckOutputSchema = z.object({
  matches: z.array(ConflictMatchSchema).default([]),
  overallSeverity: z.enum(["YESIL", "SARI", "KIRMIZI"]),
});
export type ConflictCheckOutput = z.infer<typeof ConflictCheckOutputSchema>;

/** Şema kataloğu — API/registry tarafında görev tipiyle erişim için. */
export const OUTPUT_SCHEMAS = {
  DOCUMENT_CLASSIFY: DocumentClassifyOutputSchema,
  DEADLINE_DETECT: DeadlineDetectOutputSchema,
  HEARING_PREP: HearingPrepOutputSchema,
  CASE_CHAT: CaseChatOutputSchema,
  PETITION_DRAFT: PetitionDraftOutputSchema,
  CITATION_VERIFY: CitationVerifyOutputSchema,
  OPPONENT_SIMULATION: OpponentSimulationOutputSchema,
  RISK_ASSESS: RiskAssessOutputSchema,
  CLIENT_STATUS_SUMMARY: ClientStatusSummaryOutputSchema,
  ENFORCEMENT_ANALYSIS: EnforcementAnalysisOutputSchema,
  STRATEGY_BUILD: StrategyBuildOutputSchema,
  CONFLICT_INFERENCE: ConflictCheckOutputSchema,
} as const;
