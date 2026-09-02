import { Injectable, Logger } from "@nestjs/common";
import { cosineSimilarity, scanPii } from "@nomosos/ai";
import { estimateTokens } from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";
import { AssistantLlmService } from "./assistant-llm.service";

/** Anahtar kelime yedeğinde elenen, ayırt ediciliği olmayan Türkçe kelimeler. */
const TR_STOPWORDS = new Set([
  "ve", "ile", "için", "ama", "veya", "ise", "gibi", "kadar", "sonra", "önce",
  "bir", "bu", "şu", "o", "the", "var", "yok", "mi", "mı", "mu", "mü", "de",
  "da", "ki", "ne", "nedir", "hangi", "nerede", "neden", "nasıl", "kim", "kimin",
  "olarak", "üzere", "daha", "çok", "her", "bütün", "tüm", "hem", "ancak",
  "dosya", "dosyada", "dosyanın", "belge", "belgede", "lütfen",
]);

/** Anahtar kelime yedeğinde taranacak en fazla parça (JS tarafı skorlama sınırı). */
const KEYWORD_SCAN_CAP = 400;

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  /** Cevapta gösterilecek atıf künyesi — "Cevap Dilekçesi — s.3 ¶2-4 · parça 5". */
  sourceLabel: string;
  content: string;
  score: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  /** EMBEDDING: kosinüs benzerliği · KEYWORD: ILIKE + terim skorlaması · NONE: hiç parça yok. */
  mode: "EMBEDDING" | "KEYWORD" | "NONE";
  /** Kullanıcıya gösterilecek Türkçe açıklama (yedek moda düşüldüyse nedeni). */
  notice?: string;
  /** Dosyada indekslenmiş toplam parça sayısı. */
  totalChunks: number;
  estimatedTokens: number;
}

export interface RetrieveOptions {
  topK?: number;
  /** Parçalara ayrılan token bütçesi (dosya künyesi bütçesinden ayrıdır). */
  tokenBudget?: number;
}

/**
 * RAG erişim (retrieval) katmanı.
 *
 * İKİ MOD:
 *  (a) GÖMME — parçalarda vektör varsa ve gömme sağlayıcısı çözülebiliyorsa,
 *      soru da (maskelenerek) gömülür ve kosinüs benzerliğiyle top-K seçilir.
 *      pgvector yerine JS kosinüsü kullanılır: dosya bazında parça sayısı
 *      sınırlıdır, sorgu tek dosyanın parçalarına iner.
 *  (b) ANAHTAR KELİME — gömme yoksa Postgres ILIKE (`contains`, insensitive) ile
 *      aday parçalar çekilip terim frekansına göre JS'te skorlanır. Bu durum
 *      `notice` ile kullanıcıya AÇIKÇA bildirilir; sessizce düşülmez.
 *
 * Her iki modda da dönen parçalar MASKELİ içeriktir (DocumentChunk.content) ve
 * `sourceLabel` taşır — kaynaksız parça cevapta kullanılamaz.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: AssistantLlmService,
  ) {}

  async retrieveContext(
    tenantId: string,
    caseId: string,
    question: string,
    options: RetrieveOptions = {},
  ): Promise<RetrievalResult> {
    const topK = options.topK ?? 8;
    const tokenBudget = options.tokenBudget ?? 3000;

    const totalChunks = await this.prisma.client.documentChunk.count({
      where: { tenantId, caseId },
    });
    if (totalChunks === 0) {
      return {
        chunks: [],
        mode: "NONE",
        notice:
          "Bu dosyada indekslenmiş belge parçası yok. Belgeleri indekslemek için " +
          "POST /assistant/index/:caseId ucunu çalıştırın.",
        totalChunks: 0,
        estimatedTokens: 0,
      };
    }

    const embeddedCount = await this.prisma.client.documentChunk.count({
      where: { tenantId, caseId, NOT: { embedding: { isEmpty: true } } },
    });

    if (embeddedCount > 0) {
      const semantic = await this.retrieveByEmbedding(tenantId, caseId, question, topK);
      if (semantic) {
        return this.applyBudget(semantic, "EMBEDDING", totalChunks, tokenBudget, undefined);
      }
    }

    const keyword = await this.retrieveByKeyword(tenantId, caseId, question, topK);
    const notice =
      embeddedCount > 0
        ? "Gömme sağlayıcısına ulaşılamadığı için ANAHTAR KELİME araması kullanıldı; sonuçlar anlamsal aramaya göre daha dar olabilir."
        : "Bu dosyada gömme (embedding) üretilmemiş; ANAHTAR KELİME araması kullanıldı. Anlamsal arama için Ayarlar'dan OpenAI-uyumlu veya Ollama sağlayıcı ekleyip dosyayı yeniden indeksleyin.";
    return this.applyBudget(keyword, "KEYWORD", totalChunks, tokenBudget, notice);
  }

  /* ---------------- (a) Gömme tabanlı erişim ---------------- */

  private async retrieveByEmbedding(
    tenantId: string,
    caseId: string,
    question: string,
    topK: number,
  ): Promise<RetrievedChunk[] | null> {
    const embedding = await this.llm.resolveEmbedding(tenantId);
    if (!embedding) return null;

    let queryVector: number[];
    try {
      // KVKK: soru metni de gömmeye MASKELİ gider.
      const masked = scanPii(question).maskedText;
      const [vector] = await this.llm.embed(embedding, [masked]);
      if (!vector) return null;
      queryVector = vector;
    } catch (err) {
      this.logger.warn(`Soru gömülemedi, anahtar kelimeye düşülüyor: ${(err as Error).message}`);
      return null;
    }

    const rows = await this.prisma.client.documentChunk.findMany({
      where: { tenantId, caseId, NOT: { embedding: { isEmpty: true } } },
      select: {
        id: true,
        documentId: true,
        sourceLabel: true,
        content: true,
        embedding: true,
        embeddingModel: true,
      },
    });

    const scored = rows
      // Gömme modeli değiştiyse eski vektörler kosinüste 0 üretir; açıkça de eleriz.
      .filter((r) => !r.embeddingModel || r.embeddingModel === embedding.model)
      .map((r) => ({
        chunkId: r.id,
        documentId: r.documentId,
        sourceLabel: r.sourceLabel,
        content: r.content,
        score: cosineSimilarity(queryVector, r.embedding),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.length > 0 ? scored : null;
  }

  /* ---------------- (b) Anahtar kelime yedeği ---------------- */

  private async retrieveByKeyword(
    tenantId: string,
    caseId: string,
    question: string,
    topK: number,
  ): Promise<RetrievedChunk[]> {
    const terms = this.tokenize(question);
    if (terms.length === 0) return [];

    const rows = await this.prisma.client.documentChunk.findMany({
      where: {
        tenantId,
        caseId,
        OR: terms.map((t) => ({ content: { contains: t, mode: "insensitive" as const } })),
      },
      // `embedding` BİLEREK seçilmiyor: her satırda yüzlerce float taşımanın anlamı yok.
      select: { id: true, documentId: true, sourceLabel: true, content: true },
      // İ-11: orderBy'suz take, veritabanının rasgele döndürdüğü 400 satırı
      // alıyordu — en yeni dosyalar hiç okunmadan kırpılabiliyordu. En yeni
      // önce: hukuki dosyalarda güncel dilekçe eski ekte önceliklidir.
      orderBy: { createdAt: "desc" },
      take: KEYWORD_SCAN_CAP,
    });

    return rows
      .map((r) => {
        const haystack = r.content.toLocaleLowerCase("tr-TR");
        let hits = 0;
        let matchedTerms = 0;
        for (const term of terms) {
          const count = this.countOccurrences(haystack, term);
          if (count > 0) matchedTerms += 1;
          hits += count;
        }
        // Farklı terimlerin kapsanması, aynı terimin tekrarından daha değerlidir.
        const coverage = matchedTerms / terms.length;
        const density = hits / Math.max(1, Math.ceil(r.content.length / 500));
        return {
          chunkId: r.id,
          documentId: r.documentId,
          sourceLabel: r.sourceLabel,
          content: r.content,
          score: Number((coverage * 2 + Math.min(density, 3) / 3).toFixed(4)),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private tokenize(question: string): string[] {
    return [
      ...new Set(
        question
          .toLocaleLowerCase("tr-TR")
          .replace(/[^\p{L}\p{N}\s]/gu, " ")
          .split(/\s+/)
          .map((w) => w.trim())
          .filter((w) => w.length >= 3 && !TR_STOPWORDS.has(w)),
      ),
    ].slice(0, 12);
  }

  private countOccurrences(haystack: string, needle: string): number {
    let count = 0;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      count += 1;
      from = at + needle.length;
    }
    return count;
  }

  /* ---------------- Bütçe ---------------- */

  private applyBudget(
    chunks: RetrievedChunk[],
    mode: "EMBEDDING" | "KEYWORD",
    totalChunks: number,
    tokenBudget: number,
    notice: string | undefined,
  ): RetrievalResult {
    const kept: RetrievedChunk[] = [];
    let used = 0;
    let trimmed = false;
    for (const chunk of chunks) {
      const cost = estimateTokens(chunk.content) + estimateTokens(chunk.sourceLabel);
      if (used + cost > tokenBudget) {
        trimmed = true;
        continue;
      }
      kept.push(chunk);
      used += cost;
    }

    // Tek bir parça bile bütçeye sığmıyorsa EN ALAKALI parçayı kırparak taşı:
    // "hiç kaynak yok" demek, kırpılmış kaynak göstermekten daha kötüdür.
    if (kept.length === 0 && chunks.length > 0) {
      const first = chunks[0];
      const maxChars = Math.max(400, Math.floor(tokenBudget * 3.2));
      const clipped = first.content.slice(0, maxChars);
      kept.push({
        ...first,
        content:
          clipped.length < first.content.length ? `${clipped}\n[… parça bütçe nedeniyle kırpıldı]` : clipped,
      });
      used = estimateTokens(clipped);
      trimmed = true;
    }

    const trimNotice = trimmed
      ? "Token bütçesi nedeniyle en alakalı parçalardan bazıları bağlama alınamadı."
      : undefined;

    return {
      chunks: kept,
      mode: kept.length === 0 ? "NONE" : mode,
      notice: [notice, trimNotice].filter(Boolean).join(" ") || undefined,
      totalChunks,
      estimatedTokens: used,
    };
  }
}
