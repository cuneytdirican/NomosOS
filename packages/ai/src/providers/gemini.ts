import { fetchWithTimeout } from "../http";
import type { LlmChatOptions, LlmChatResult, LlmConnectionTest, LlmProvider, ResolvedProviderConfig } from "../types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements LlmProvider {
  readonly type = "GEMINI" as const;

  constructor(private readonly config: ResolvedProviderConfig) {}

  private baseUrl(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    const systemParts = options.messages.filter((m) => m.role === "system").map((m) => ({ text: m.content }));
    const contents = options.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const res = await fetchWithTimeout(
      `${this.baseUrl()}/models/${encodeURIComponent(options.model)}:generateContent?key=${this.config.apiKey ?? ""}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
          contents,
          generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
          },
        }),
      }
    );
    if (!res.ok) {
      throw new Error(`Gemini API hatası (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    return {
      content:
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("") ?? "",
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetchWithTimeout(`${this.baseUrl()}/models?key=${this.config.apiKey ?? ""}`);
    if (!res.ok) throw new Error(`Gemini model listesi alınamadı (${res.status})`);
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name.replace(/^models\//, ""));
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
