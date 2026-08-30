import { fetchWithTimeout } from "../http";
import type { LlmChatOptions, LlmChatResult, LlmConnectionTest, LlmProvider, ResolvedProviderConfig } from "../types";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

export class AnthropicProvider implements LlmProvider {
  readonly type = "ANTHROPIC" as const;

  constructor(private readonly config: ResolvedProviderConfig) {}

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.config.apiKey ?? "",
      "anthropic-version": API_VERSION,
    };
  }

  private baseUrl(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    const system = options.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = options.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetchWithTimeout(`${this.baseUrl()}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        system: system || undefined,
        messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API hatası (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      content: data.content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join(""),
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetchWithTimeout(`${this.baseUrl()}/v1/models`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Anthropic model listesi alınamadı (${res.status})`);
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
