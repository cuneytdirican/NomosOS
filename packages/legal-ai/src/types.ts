/**
 * @nomosos/legal-ai — ortak tipler.
 *
 * Bu paket, @nomosos/ai'nin ham LLM çağrı katmanının ÜZERİNDE çalışır:
 * sağlayıcı seçimi, anahtar şifreleme, PII taraması ve HTTP çağrısı orada;
 * sistem promptları, çıktı şemaları, bağlam kurma ve doğrulama burada.
 */

import type { LlmMessage } from "@nomosos/ai";
import type { AiTaskType } from "@nomosos/shared";

export type { LlmMessage };

/** Bir hukuki görev tipinin prompt sözleşmesi. */
export interface PromptSpec {
  /** BYO-LLM görev tipi → model eşlemesinin anahtarı. */
  readonly taskType: AiTaskType;
  /** İnsan-okur ajan/görev adı (Türkçe). */
  readonly name: string;
  /** Göreve özel sistem promptu (çekirdek prompt ile birleştirilir). */
  readonly system: string;
  /** Türkçe few-shot örneği: kullanıcı girdisi + beklenen JSON çıktısı. */
  readonly fewShot: readonly LlmMessage[];
  /** Çıktının JSON olması bekleniyor mu? (guard JSON ayrıştırması için) */
  readonly expectsJson: boolean;
}

/** Bir bulgunun dayandığı yer (belge + konum). */
export interface SourceRef {
  documentId?: string;
  documentTitle?: string;
  page?: number;
  paragraph?: number;
  /** Belgeden birebir alıntı — kaynaksız iddia elemesinin dayanağı. */
  quote?: string;
}

/** Ajan tetikleyici tipleri (Modül 21). */
export type AgentTriggerType = "EVENT" | "MANUAL" | "SCHEDULED";

/** İnsan onay modeli (Modül 21 → AgentDefinition.approval_mode). */
export type AgentApprovalMode =
  | "MANDATORY" // Avukat onayı olmadan kayıt oluşmaz
  | "CONFIDENCE_GATED" // Güven eşiğinin altında onaya düşer
  | "INFORMATIONAL" // Bilgilendirici; kayıt yazmaz
  | "GATE"; // Onay değil kapı (Teyit Ajanı)

/** Ajan tetikleyici tanımı. */
export interface AgentTrigger {
  readonly type: AgentTriggerType;
  /** EVENT için olay anahtarı, SCHEDULED için cron ifadesi. */
  readonly eventKey?: string;
  readonly cron?: string;
  readonly description: string;
}
