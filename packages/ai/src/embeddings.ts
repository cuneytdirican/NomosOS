/**
 * Gömme (embedding) yeteneği — RAG erişiminin (retrieval) sayısal tabanı.
 *
 * TASARIM KARARLARI (Faz 2):
 *  1. pgvector KULLANILMAZ. Vektörler Prisma `Float[]` alanında saklanır ve
 *     benzerlik JS tarafında kosinüs ile hesaplanır. Dosya bazında parça sayısı
 *     sınırlı olduğu için (tek dosyanın belgeleri) bu yeterlidir; ölçek
 *     gerektiğinde pgvector'a geçiş yalnızca depolama katmanını ilgilendirir.
 *  2. YALNIZCA İKİ SAĞLAYICI destekler: OPENAI_COMPAT (/embeddings) ve
 *     OLLAMA (/api/embed | /api/embeddings). ANTHROPIC, GEMINI ve CUSTOM için
 *     gömme uçları ya yoktur ya da standart dışıdır; sessizce yanlış sonuç
 *     üretmektense anlaşılır bir Türkçe hata verip ANAHTAR KELİME yedeğine
 *     düşülür (çağıran katman bunu kullanıcıya bildirir).
 *  3. KVKK: bu fonksiyon kendisi maskeleme YAPMAZ. Çağıran, gömmeye giden her
 *     metni `scanPii` hattından geçirmiş olmalıdır. NomosOS'ta gömülen metin
 *     `DocumentChunk.content`tir ve o alan zaten MASKELİ saklanır; soru metni de
 *     gömmeden önce maskelenir. Böylece dış gömme sağlayıcısına ham kişisel veri
 *     gitmez.
 */

import { fetchWithTimeout } from "./http";
import type { ResolvedProviderConfig } from "./types";

/** Gömme desteği olan sağlayıcı tipleri. */
export const EMBEDDING_PROVIDER_TYPES = ["OPENAI_COMPAT", "OLLAMA"] as const;
export type EmbeddingProviderType = (typeof EMBEDDING_PROVIDER_TYPES)[number];

/** Desteklenmeyen sağlayıcılarda kullanıcıya gösterilen çözüm önerili hata metni. */
export const EMBEDDING_UNSUPPORTED_MESSAGE =
  "Bu sağlayıcı gömme (embedding) desteklemiyor. Anahtar kelime araması kullanılacak " +
  "veya Ayarlar'dan OpenAI-uyumlu/Ollama sağlayıcı ekleyin.";

/** Sağlayıcı tipi gömme üretebilir mi? */
export function supportsEmbeddings(type: string): type is EmbeddingProviderType {
  return (EMBEDDING_PROVIDER_TYPES as readonly string[]).includes(type);
}

/**
 * Model adı verilmediğinde kullanılacak makul varsayılanlar.
 * Büro kendi modelini seçtiyse (env / ayar) o kazanır.
 */
export const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProviderType, string> = {
  OPENAI_COMPAT: "text-embedding-3-small",
  OLLAMA: "nomic-embed-text",
};

function openAiHeaders(config: ResolvedProviderConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    ...(config.headers ?? {}),
  };
}

function normalizeBaseUrl(url: string | undefined, fallback: string): string {
  return (url ?? fallback).replace(/\/$/, "");
}

function assertVectors(vectors: unknown, expectedCount: number): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new Error(
      `Gömme sağlayıcısı beklenen sayıda vektör döndürmedi (beklenen ${expectedCount}, gelen ${
        Array.isArray(vectors) ? vectors.length : 0
      }).`,
    );
  }
  const result: number[][] = [];
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length === 0 || vector.some((n) => typeof n !== "number")) {
      throw new Error("Gömme sağlayıcısı geçersiz bir vektör döndürdü (sayısal dizi bekleniyordu).");
    }
    result.push(vector as number[]);
  }
  return result;
}

async function embedOpenAiCompat(
  config: ResolvedProviderConfig,
  texts: string[],
  model: string,
): Promise<{ vectors: number[][]; inputTokens?: number }> {
  const baseUrl = normalizeBaseUrl(config.baseUrl, "https://api.openai.com/v1");
  const res = await fetchWithTimeout(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: openAiHeaders(config),
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`Gömme servisi hatası (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
    // DENETİM (AI-AUDIT A1): sağlayıcının bildirdiği GERÇEK token sayısı
    // eskiden okunmuyordu — gömme maliyeti kullanım raporlarında görünmezdi.
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };
  const rows = data.data ?? [];
  // Sağlayıcı sırayı garanti etmeyebilir; index alanı varsa ona göre yerleştir.
  const ordered: unknown[] = new Array(texts.length);
  rows.forEach((row, i) => {
    const at = typeof row.index === "number" ? row.index : i;
    ordered[at] = row.embedding;
  });
  return {
    vectors: assertVectors(ordered, texts.length),
    inputTokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens,
  };
}

async function embedOllama(
  config: ResolvedProviderConfig,
  texts: string[],
  model: string,
): Promise<{ vectors: number[][]; inputTokens?: number }> {
  const baseUrl = normalizeBaseUrl(config.baseUrl, "http://localhost:11434");

  // Önce toplu uç (/api/embed, yeni Ollama sürümleri) denenir.
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
    });
    if (res.ok) {
      const data = (await res.json()) as { embeddings?: number[][] };
      if (Array.isArray(data.embeddings) && data.embeddings.length === texts.length) {
        return { vectors: assertVectors(data.embeddings, texts.length) };
      }
    }
  } catch {
    // Eski sürüm veya uç yok — tekil uca düş.
  }

  // Yedek: /api/embeddings her metin için bir çağrı.
  const vectors: number[][] = [];
  for (const text of texts) {
    const res = await fetchWithTimeout(`${baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(`Ollama gömme hatası (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { embedding?: number[] };
    vectors.push(data.embedding as number[]);
  }
  return { vectors: assertVectors(vectors, texts.length) };
}

/**
 * Metin listesini vektörlere çevirir.
 *
 * @returns `vectors` girdiyle AYNI SIRADADIR; `inputTokens` sağlayıcı bildirdiyse
 *   gerçek token sayısıdır (OpenAI-uyumlu) — kullanım kaydı/AI Kullanım raporları
 *   bunu okur. OLLAMA/CUSTOM bildirmez: `undefined` ≠ 0.
 *
 * @throws Sağlayıcı gömme desteklemiyorsa `EMBEDDING_UNSUPPORTED_MESSAGE`.
 */
export interface EmbedCallResult {
  vectors: number[][];
  inputTokens?: number;
}

export async function embedTexts(
  config: ResolvedProviderConfig,
  texts: string[],
  model: string,
): Promise<EmbedCallResult> {
  if (texts.length === 0) return { vectors: [] };
  if (!supportsEmbeddings(config.type)) {
    throw new Error(EMBEDDING_UNSUPPORTED_MESSAGE);
  }
  if (!model || !model.trim()) {
    throw new Error("Gömme modeli belirtilmedi. Ayarlar'dan bir gömme modeli seçin.");
  }
  return config.type === "OLLAMA"
    ? embedOllama(config, texts, model)
    : embedOpenAiCompat(config, texts, model);
}

/**
 * Kosinüs benzerliği. Farklı boyutlu veya sıfır vektörlerde 0 döner
 * (gömme modeli değişmişse eski parçalar kendiliğinden elenir).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
