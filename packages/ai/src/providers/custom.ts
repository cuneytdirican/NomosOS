import { fetchWithTimeout } from "../http";
import type {
  CustomMapping,
  LlmChatOptions,
  LlmChatResult,
  LlmConnectionTest,
  LlmProvider,
  ResolvedProviderConfig,
} from "../types";
import { getPath, setPath } from "../types";

const DEFAULT_MAPPING: CustomMapping = {
  requestMessagesField: "messages",
  requestModelField: "model",
  responseTextField: "choices.0.message.content",
};

/**
 * Tamamen özel LLM endpoint'i — hiçbir standarda uymayan şirket-içi modeller için.
 * Kullanıcı tanımlar: endpoint URL (baseUrl), ek header'lar, istek/yanıt alan eşlemesi.
 * İstek: POST baseUrl, gövde eşlemeye göre kurulur. Yanıt: responseTextField yolundan okunur.
 */
export class CustomProvider implements LlmProvider {
  readonly type = "CUSTOM" as const;
  private readonly mapping: CustomMapping;

  constructor(private readonly config: ResolvedProviderConfig) {
    this.mapping = { ...DEFAULT_MAPPING, ...(config.mapping ?? {}) };
    if (!config.baseUrl) {
      throw new Error("CUSTOM sağlayıcı için endpoint URL (baseUrl) zorunludur.");
    }
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(this.config.headers ?? {}),
    };
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    const body: Record<string, unknown> = {};
    setPath(body, this.mapping.requestModelField, options.model);
    setPath(body, this.mapping.requestMessagesField, options.messages);
    if (options.maxTokens !== undefined) body["max_tokens"] = options.maxTokens;
    if (options.temperature !== undefined) body["temperature"] = options.temperature;

    const res = await fetchWithTimeout(this.config.baseUrl as string, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Özel LLM endpoint hatası (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as unknown;
    const text = getPath(data, this.mapping.responseTextField);
    if (typeof text !== "string") {
      throw new Error(
        `Yanıtta '${this.mapping.responseTextField}' yolunda metin bulunamadı. Alan eşlemesini kontrol edin.`
      );
    }
    return { content: text };
  }

  async listModels(): Promise<string[]> {
    // Özel endpoint'lerde standart model listesi yoktur; yapılandırılan model döndürülür.
    return [this.config.defaultModel];
  }

  async testConnection(): Promise<LlmConnectionTest> {
    try {
      const result = await this.chat({
        model: this.config.defaultModel,
        messages: [{ role: "user", content: "Bağlantı testi. Tek kelimeyle yanıtla: TAMAM" }],
        maxTokens: 10,
      });
      return { ok: true, message: `Bağlantı başarılı. Yanıt: ${result.content.slice(0, 50)}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
