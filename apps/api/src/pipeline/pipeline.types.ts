import type { DocumentClass, ProposalType } from "@nomosos/db";
import type { DeadlineDetection, DocumentClassifyOutput } from "@nomosos/legal-ai";

/**
 * Belge → Aksiyon hattının adım sözleşmesi.
 *
 * KUYRUĞA HAZIR TASARIM: Faz 2'de hat SENKRON koşar (yükleme isteği içinde),
 * ancak her adım kendi girdisini `PipelineContext`ten okuyup çıktısını yine
 * oraya yazan SAF bir fonksiyondur. BullMQ'ya taşındığında değişecek tek şey
 * `PipelineService.run`ın adımları sırayla değil kuyruk üzerinden çağırması
 * olacaktır; adım gövdeleri aynen kalır.
 */

/** Adım kodları — PipelineRun.stepsJson içinde bu kodlarla saklanır. */
export const PIPELINE_STEP_CODES = [
  "OCR",
  "CLASSIFY",
  "MATCH_CASE",
  "EXTRACT",
  "DETECT_DEADLINE",
  "BANKA_CEVABI",
  "CREATE_TASKS",
  "NOTIFY",
] as const;
export type PipelineStepCode = (typeof PIPELINE_STEP_CODES)[number];

export const PIPELINE_STEP_LABELS: Record<PipelineStepCode, string> = {
  OCR: "Metin çıkarma",
  CLASSIFY: "Sınıflandırma",
  MATCH_CASE: "Dosya eşleme",
  EXTRACT: "Veri çıkarma",
  DETECT_DEADLINE: "Süre tespiti",
  BANKA_CEVABI: "Banka cevabı analizi",
  CREATE_TASKS: "Görev önerisi",
  NOTIFY: "Bildirim",
};

/** Bir adımın sonucu. BASARISIZ adım hattı DURDURMAZ (koşum KISMI olur). */
export type PipelineStepStatus = "TAMAM" | "BASARISIZ" | "ATLANDI";

export interface PipelineStepResult {
  status: PipelineStepStatus;
  /** İnsan-okur özet (UI'daki hat zaman çizgisinde gösterilir). */
  detail?: string;
  /** BASARISIZ ise Türkçe hata mesajı. */
  error?: string;
  /** Adımın ürettiği, denetlenebilir çıktı özeti (JSON'a yazılır). */
  output?: Record<string, unknown>;
  /** Adımın ürettiği öneri taslakları — kalıcı öneri öneri kuyruğuna gider. */
  proposalDrafts?: ProposalDraft[];
}

/** stepsJson içindeki tek kayıt. */
export interface PipelineStepRecord extends PipelineStepResult {
  step: PipelineStepCode;
  label: string;
  durationMs: number;
  startedAt: string;
}

/** Onay kuyruğuna düşecek öneri (henüz DB'ye yazılmamış hâli). */
export interface ProposalDraft {
  type: ProposalType;
  title: string;
  payload: Record<string, unknown>;
  confidence?: number;
  reasoning?: string;
  /** Belgeden birebir alıntı — kaynaksız öneri üretilmez. */
  sourceQuote?: string;
  /** Öneri belirli bir dosyaya bağlıysa. */
  caseId?: string | null;
}

/** Deterministik metin çıkarımıyla bulunan, kaynaklı tespit. */
export interface TextFinding {
  kind: "ISTENEN_BELGE" | "VERILEN_SURE" | "TALEP" | "DURUSMA_TARIHI";
  label: string;
  /** Belgeden birebir alıntı. */
  quote: string;
  /** DURUSMA_TARIHI için ISO tarih. */
  isoDate?: string;
}

/** Hattın adımlar arasında taşıdığı durum. */
export interface PipelineContext {
  tenantId: string;
  /** Yüklemeyi yapan kullanıcı (UYAP/e-posta kaynağında undefined). */
  userId?: string;
  documentId: string;
  documentName: string;
  storageKey: string;
  mimeType?: string | null;
  /** Yükleyenin belirttiği dosya (varsa). Adım 3 bunu teyit eder. */
  caseId: string | null;
  /** Kullanıcı dosyayı elle seçtiyse adım 3 eşleme aramaz. */
  caseIdWasGivenByUser: boolean;

  // ---- Adım çıktıları ----
  /** HAM (maskesiz) metin — yalnızca sunucu içinde kalır, LLM'e maskeli gider. */
  text?: string;
  pageCount?: number;
  classification?: DocumentClassifyOutput;
  /** Sınıflandırma güveni eşiğin altındaysa belge triyaj kuyruğunda kalır. */
  triage: boolean;
  findings: TextFinding[];
  detections: DeadlineDetection[];
  /** Hat sonunda toplu yazılacak öneriler. */
  proposals: ProposalDraft[];
  /** Bu koşumda dış sağlayıcıya maskeli metin gönderildi mi (KVKK izi). */
  piiMasked: boolean;
  /** Adım notları — stepsJson dışında kullanıcıya gösterilecek uyarılar. */
  warnings: string[];
}

/** Kuyruğa taşınabilir adım birimi. */
export interface PipelineStep {
  readonly code: PipelineStepCode;
  run(ctx: PipelineContext): Promise<PipelineStepResult>;
}

/** Sınıflandırma bu eşiğin altındaysa sınıf DIGER kalır ve belge triyaja düşer. */
export const CLASSIFY_CONFIDENCE_THRESHOLD = 0.7;

/** Dosya eşlemesi bu eşiğin altındaysa otomatik bağlanmaz, öneri üretilir. */
export const MATCH_CASE_CONFIDENCE_THRESHOLD = 0.9;

/** classSource alanına yazılan önekler (Document.classSource serbest metindir). */
export const CLASS_SOURCE = {
  MANUEL: "MANUEL",
  AI: "AI",
  /** Eşik altı AI sınıflandırması — triyaj kuyruğunun işareti. */
  AI_LOW: "AI_DUSUK_GUVEN",
} as const;

/** `AI:0.94` biçiminde kaynak etiketi üretir. */
export function classSourceLabel(prefix: string, confidence?: number): string {
  return confidence === undefined ? prefix : `${prefix}:${confidence.toFixed(2)}`;
}

/** Belge sınıfının süre doğurma ihtimali var mı? (adım 5 kapısı) */
export function classCanTriggerDeadline(cls: DocumentClass): boolean {
  return (
    cls === "ARA_KARAR" ||
    cls === "GEREKCELI_KARAR" ||
    cls === "TEBLIGAT" ||
    cls === "BILIRKISI_RAPORU" ||
    cls === "TENSIP_ZAPTI" ||
    cls === "DURUSMA_TUTANAGI" ||
    cls === "MUZEKKERE" ||
    cls === "ICRA_EVRAKI"
  );
}
