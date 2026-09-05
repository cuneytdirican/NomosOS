import { fetchWithTimeout } from "../http";
import type { LlmChatOptions, LlmChatResult, LlmConnectionTest, LlmProvider, ResolvedProviderConfig } from "../types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * OpenAI SSE akışını okur: `data: {json}` satırları, `[DONE]` ile biter.
 * `choices[0].delta.content` birleştirilir; `usage` (varsa) son parçadan alınır.
 */
export async function readSseChat(res: Response): Promise<LlmChatResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("OpenAI-uyumlu API akış gövdesi boş.");
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let json: { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: unknown };
    try {
      json = JSON.parse(payload);
    } catch {
      return; // bozuk satır: yok say (sunucu yorum/ısınma satırı gönderebilir)
    }
    if (json.error) throw new Error(`OpenAI-uyumlu API akış hatası: ${JSON.stringify(json.error).slice(0, 300)}`);
    const piece = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content;
    if (typeof piece === "string") content += piece;
    if (json.usage) {
      inputTokens = json.usage.prompt_tokens ?? inputTokens;
      outputTokens = json.usage.completion_tokens ?? outputTokens;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.trim()) handleLine(buffer);
  return { content, inputTokens, outputTokens };
}

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
    const body = {
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      messages: options.messages,
    };
    // JSON modu: destekleyen sunucularda çıktı geçerli JSON'a zorlanır.
    // Sunucular farklı sözlük konuşur — LM Studio yalnız `json_schema`,
    // eski OpenAI-uyumlular yalnız `json_object` kabul eder. Sıra:
    // json_schema (serbest nesne) → json_object → ipucusuz. 400 dışı hata yinelenmez.
    const attempts: Array<Record<string, unknown>> =
      options.responseFormat === "json"
        ? [
            { ...body, response_format: { type: "json_schema", json_schema: { name: "nomosos_output", schema: { type: "object" } } } },
            { ...body, response_format: { type: "json_object" } },
            body,
          ]
        : [body];
    // AKIŞLI YANIT (SSE): yerel/yavaş modellerde (LM Studio, Ollama-OpenAI, vLLM)
    // ilk bayt dakikalar sonra gelebilir; undici'nin 300 sn başlık zaman aşımı
    // (UND_ERR_HEADERS_TIMEOUT) akışsız isteği düşürür. Akışta başlıklar anında,
    // gövde parça parça gelir; metin burada birleştirilir, kullanım son parçadan
    // okunur (`stream_options.include_usage`). Akışı reddeden sunucu (400) için
    // akışsız yinelenir.
    let res: Response | undefined;
    let streamed = true;
    for (const attempt of attempts) {
      res = await this.post({ ...attempt, stream: true, stream_options: { include_usage: true } });
      if (res.status === 400) {
        // Önce akış ipucunu düşür (aynı biçim), sonra bir sonraki biçime geç.
        res = await this.post(attempt);
        streamed = false;
        if (res.status !== 400 || attempt === body) break;
        streamed = true;
        continue;
      }
      break;
    }
    if (!res) throw new Error("OpenAI-uyumlu API çağrısı yapılamadı.");
    if (!res.ok) {
      throw new Error(`OpenAI-uyumlu API hatası (${res.status}): ${await res.text()}`);
    }
    if (streamed && res.headers?.get?.("content-type")?.includes("text/event-stream")) {
      return readSseChat(res);
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

  private post(payload: Record<string, unknown>): Promise<Response> {
    return fetchWithTimeout(`${this.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
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
