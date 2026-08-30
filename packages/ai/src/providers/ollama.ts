import { fetchWithTimeout } from "../http";
import type { LlmChatOptions, LlmChatResult, LlmConnectionTest, LlmProvider, ResolvedProviderConfig } from "../types";

const DEFAULT_BASE_URL = "http://localhost:11434";

/**
 * Ollama — yerel modeller. KVKK "veri dışarı çıkmaz" senaryosunun ana taşıyıcısı:
 * bu sağlayıcı seçildiğinde hiçbir veri büro ağının dışına gönderilmez.
 */
export class OllamaProvider implements LlmProvider {
  readonly type = "OLLAMA" as const;

  constructor(private readonly config: ResolvedProviderConfig) {}

  private baseUrl(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    const res = await fetchWithTimeout(`${this.baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        stream: false,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
        messages: options.messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama API hatası (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      content: data.message?.content ?? "",
      inputTokens: data.prompt_eval_count,
      outputTokens: data.eval_count,
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetchWithTimeout(`${this.baseUrl()}/api/tags`);
    if (!res.ok) throw new Error(`Ollama model listesi alınamadı (${res.status})`);
    const data = (await res.json()) as { models: Array<{ name: string }> };
    return data.models.map((m) => m.name);
  }

  async testConnection(): Promise<LlmConnectionTest> {
    try {
      const models = await this.listModels();
      return {
        ok: true,
        message: `Ollama bağlantısı başarılı. Yüklü modeller: ${models.join(", ") || "(yok — 'ollama pull' ile model indirin)"}`,
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
