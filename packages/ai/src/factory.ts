import type { LlmProvider, ResolvedProviderConfig } from "./types";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAiCompatProvider } from "./providers/openai-compat";
import { OllamaProvider } from "./providers/ollama";
import { GeminiProvider } from "./providers/gemini";
import { CustomProvider } from "./providers/custom";

/** Yapılandırmadan sağlayıcı örneği üretir. Yeni sağlayıcı türü buraya eklenir. */
export function createProvider(config: ResolvedProviderConfig): LlmProvider {
  switch (config.type) {
    case "ANTHROPIC":
      return new AnthropicProvider(config);
    case "OPENAI_COMPAT":
      return new OpenAiCompatProvider(config);
    case "OLLAMA":
      return new OllamaProvider(config);
    case "GEMINI":
      return new GeminiProvider(config);
    case "CUSTOM":
      return new CustomProvider(config);
    default:
      throw new Error(`Bilinmeyen sağlayıcı türü: ${config.type as string}`);
  }
}
