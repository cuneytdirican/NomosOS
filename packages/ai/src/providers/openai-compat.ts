import { fetchWithTimeout } from "../http";
import type { LlmChatOptions, LlmChatResult, LlmConnectionTest, LlmProvider, ResolvedProviderConfig } from "../types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * OpenAI ve OpenAI-uyumlu tüm endpoint'ler: Azure OpenAI, OpenRouter, Groq, vLLM,
 * LM Studio vb. Tek fark baseUrl (ve gerekiyorsa ek header'lar).
 */
export class OpenAiCompatProvider implements LlmProvider {
  readonly type = "OPENAI_COMPAT" as const;

  constructor(private readonly config: ResolvedProviderConfig) {}

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(this.config.headers ?? {}),
    };
  }

  private baseUrl(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    const res = await fetchWithTimeout(`${this.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        messages: options.messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI-uyumlu API hatası (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: data.choices[0]?.message?.content ?? "",
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetchWithTimeout(`${this.baseUrl()}/models`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Model listesi alınamadı (${res.status})`);
    const data = (await res.json()) as { data: Array<{ id: string }> };
    return data.data.map((m) => m.id);
  }

  async testConnection(): Promise<LlmConnectionTest> {
    try {
      const models = await this.listModels();
      return { ok: true, message: `Bağlantı başarılı. ${models.length} model erişilebilir.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
