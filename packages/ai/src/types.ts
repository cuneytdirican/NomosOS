import type { AiProviderType } from "@nomosos/shared";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  model: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  /**
   * Çıktı biçimi ipucu. "json": sağlayıcı destekliyorsa yapısal JSON modu
   * istenir (OpenAI `response_format: json_object`; LM Studio, vLLM, Groq…).
   * Küçük yerel modeller serbest metinde JSON'u bozar — bu ipucu output-guard
   * reddini belirgin azaltır. Desteklemeyen sunucu 400 dönerse ipucu düşürülüp
   * istek YİNELENİR (davranış değişmez).
   */
  responseFormat?: "text" | "json";
}

export interface LlmChatResult {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmConnectionTest {
  ok: boolean;
  message: string;
}

/**
 * Tüm sağlayıcı adaptörlerinin uyguladığı ortak arayüz.
 * Yeni bir sağlayıcı eklemek = bu arayüzü uygulayan bir sınıf + factory'ye kayıt.
 */
export interface LlmProvider {
  readonly type: AiProviderType;
  chat(options: LlmChatOptions): Promise<LlmChatResult>;
  listModels(): Promise<string[]>;
  testConnection(): Promise<LlmConnectionTest>;
}

/** CUSTOM sağlayıcı için istek/yanıt alan eşlemesi. */
export interface CustomMapping {
  /** İstek gövdesinde mesaj listesinin yazılacağı alan yolu (nokta ayraçlı). */
  requestMessagesField: string;
  /** İstek gövdesinde model adının yazılacağı alan yolu. */
  requestModelField: string;
  /** Yanıtta üretilen metnin okunacağı alan yolu (örn. "choices.0.message.content"). */
  responseTextField: string;
}

/** Çözülmüş (şifresi açılmış) sağlayıcı yapılandırması. */
export interface ResolvedProviderConfig {
  type: AiProviderType;
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  headers?: Record<string, string>;
  mapping?: CustomMapping;
}

/** Nokta ayraçlı yol ile nesneden değer okur: getPath(obj, "choices.0.message.content") */
export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/** Nokta ayraçlı yol ile nesneye değer yazar (ara nesneleri oluşturur). */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}
