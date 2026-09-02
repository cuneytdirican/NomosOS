import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { scanPii, EMBEDDING_UNSUPPORTED_MESSAGE } from "@nomosos/ai";
import { chunkDocument, estimateTokens } from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { AssistantLlmService } from "./assistant-llm.service";
import type { IndexCaseInput } from "./assistant.dto";

/** Gömme çağrısı başına gönderilecek en fazla parça (sağlayıcı istek sınırı). */
const EMBED_BATCH_SIZE = 32;

/**
 * Aynı anda koşacak gömme partisi sayısı.
 *
 * Partiler eskiden TAMAMEN SIRALI koşuyordu: 40 belgelik bir dosya × belge
 * başına onlarca parça = yüzlerce ardışık HTTP çağrısı, hepsi TEK istek içinde.
 * Sınırlı eşzamanlılık toplam süreyi kısaltır; sınırsız `Promise.all` ise
 * sağlayıcının hız sınırına takılırdı.
 */
const EMBED_CONCURRENCY = 3;

/**
 * Tek istekte indekslenecek en fazla belge.
 *
 * Faz 2'de indeksleme SENKRONDUR; sınırsız bırakılırsa istek dakikalarca açık
 * kalır. Sınır aşıldığında kalan belgeler bildirilir ve kullanıcı ikinci bir
 * çağrı yapar (BullMQ kuyruğu Faz 3).
 */
const MAX_DOCUMENTS_PER_RUN = 25;

export interface IndexedDocumentResult {
  documentId: string;
  name: string;
  chunkCount: number;
  embedded: boolean;
  status: "INDEKSLENDI" | "ATLANDI" | "BASARISIZ";
  reason?: string;
}

export interface IndexCaseResult {
  caseId: string;
  documentCount: number;
  chunkCount: number;
  /** Erişim (retrieval) hangi modda çalışacak? */
  retrievalMode: "EMBEDDING" | "KEYWORD";
  embeddingModel?: string;
  /** Kullanıcıya gösterilecek Türkçe bilgilendirme (yedek moda düşüldüyse nedeni). */
  notice: string;
  documents: IndexedDocumentResult[];
}

/**
 * RAG indeksleme hattı.
 *
 * AKIŞ: Document.ocrText (HAM metin, sunucudan çıkmaz)
 *   → legal-ai `chunkDocument` (paragraf sınırı korunur, örtüşmeli)
 *   → HER PARÇA `scanPii` ile MASKELENİR
 *   → (varsa) gömme sağlayıcısına MASKELİ metin gider
 *   → DocumentChunk'a MASKELİ içerik + vektör yazılır.
 *
 * KVKK: ham metin hiçbir aşamada dış sağlayıcıya gitmez; DocumentChunk.content
 * kalıcı olarak maskelidir (packages/db şema notu ile aynı sözleşme).
 *
 * Faz 2'de SENKRON çalışır. Adımlar (parçala → maskele → gömle → yaz) ayrı
 * fonksiyonlar hâlinde tutulur ki Faz 3'te BullMQ işine taşınabilsin.
 */
@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: AssistantLlmService,
  ) {}

  async indexCase(user: AuthUser, caseId: string, input: IndexCaseInput): Promise<IndexCaseResult> {
    // [DÜZELTME] ROL KAPISI. Bu uç, bir dosyanın TÜM belge metnini parçalayıp
    // (maskeli de olsa) dış bir gömme sağlayıcısına gönderir ve maliyeti büroya
    // yazar. Toplu veri gönderen bir uç en az hukuki rol istemelidir.
    assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "dosya belgelerini AI için indeksleme");

    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");

    const allDocuments = await this.prisma.client.document.findMany({
      where: {
        tenantId: user.tenantId,
        caseId,
        deletedAt: null,
        ...(input?.documentIds?.length ? { id: { in: input.documentIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        class: true,
        ocrText: true,
        chunkStatus: true,
        _count: { select: { chunks: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    // Senkron koşum sınırı: kalanlar bildirilir, sessizce düşürülmez.
    const documents = allDocuments.slice(0, MAX_DOCUMENTS_PER_RUN);
    const remaining = allDocuments.length - documents.length;

    const embedding = await this.llm.resolveEmbedding(user.tenantId);
    let embeddingUsable = embedding !== null;
    let embeddingFailure: string | undefined;

    const results: IndexedDocumentResult[] = [];
    let totalChunks = 0;

    for (const doc of documents) {
      const text = (doc.ocrText ?? "").trim();
      if (!text) {
        results.push({
          documentId: doc.id,
          name: doc.name,
          chunkCount: 0,
          embedded: false,
          status: "ATLANDI",
          reason: "Belgeden metin çıkarılmamış (OCR/metin çıkarma hattı henüz koşmadı).",
        });
        continue;
      }
      if (!input?.force && doc.chunkStatus === "TAMAM" && doc._count.chunks > 0) {
        results.push({
          documentId: doc.id,
          name: doc.name,
          chunkCount: doc._count.chunks,
          embedded: false,
          status: "ATLANDI",
          reason: "Zaten indekslenmiş (yeniden indekslemek için force: true gönderin).",
        });
        totalChunks += doc._count.chunks;
        continue;
      }

      try {
        // 1) Parçala — paragraf sınırlarını koruyan, örtüşmeli chunker.
        const chunks = chunkDocument(text, {
          documentId: doc.id,
          documentTitle: doc.name,
          documentClass: doc.class,
        });

        // 2) MASKELE (KVKK) — saklanan ve gömülen metin daima maskelidir.
        const maskedContents = chunks.map((c) => scanPii(c.content).maskedText);

        // 3) Gömme (varsa).
        let vectors: number[][] = [];
        if (embedding && embeddingUsable) {
          try {
            vectors = await this.embedInBatches(embedding, maskedContents);
          } catch (err) {
            embeddingUsable = false;
            embeddingFailure = (err as Error).message;
            this.logger.warn(`Gömme üretilemedi, anahtar kelime yedeğine düşüldü: ${embeddingFailure}`);
            vectors = [];
          }
        }

        // 4) Yaz — belgenin eski parçaları silinip yenileri tek işlemde yazılır.
        await this.prisma.client.$transaction([
          this.prisma.client.documentChunk.deleteMany({
            where: { tenantId: user.tenantId, documentId: doc.id },
          }),
          this.prisma.client.documentChunk.createMany({
            data: chunks.map((c, i) => ({
              tenantId: user.tenantId,
              documentId: doc.id,
              caseId,
              index: c.chunkIndex,
              content: maskedContents[i],
              tokenCount: estimateTokens(maskedContents[i]),
              embedding: vectors[i] ?? [],
              embeddingModel: vectors[i] ? embedding?.model : null,
              sourceLabel: `${c.citationLabel} · parça ${i + 1}`,
            })),
          }),
          this.prisma.client.document.update({
            where: { id: doc.id },
            data: { chunkStatus: "TAMAM" },
          }),
        ]);

        totalChunks += chunks.length;
        results.push({
          documentId: doc.id,
          name: doc.name,
          chunkCount: chunks.length,
          embedded: vectors.length > 0,
          status: "INDEKSLENDI",
        });
      } catch (err) {
        await this.prisma.client.document.update({
          where: { id: doc.id },
          data: { chunkStatus: "BASARISIZ" },
        });
        results.push({
          documentId: doc.id,
          name: doc.name,
          chunkCount: 0,
          embedded: false,
          status: "BASARISIZ",
          reason: (err as Error).message,
        });
      }
    }

    const embeddedAny = results.some((r) => r.embedded);
    const retrievalMode: "EMBEDDING" | "KEYWORD" = embeddedAny ? "EMBEDDING" : "KEYWORD";

    const baseNotice = embeddedAny
      ? `Anlamsal arama etkin (gömme modeli: ${embedding?.model}).`
      : embeddingFailure
        ? `Gömme üretilemediği için ANAHTAR KELİME araması kullanılacak. Neden: ${embeddingFailure}`
        : `Gömme (embedding) sağlayıcısı tanımlı olmadığı için ANAHTAR KELİME araması kullanılacak. ${EMBEDDING_UNSUPPORTED_MESSAGE}`;
    const notice =
      remaining > 0
        ? `${baseNotice} Bu koşumda ${MAX_DOCUMENTS_PER_RUN} belge indekslendi; ${remaining} belge ` +
          "kaldı. Kalanları indekslemek için ucu tekrar çağırın."
        : baseNotice;

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_CASE_INDEX",
      entity: "Case",
      entityId: caseId,
      detail: `belge=${results.length} parca=${totalChunks} mod=${retrievalMode}`,
    });

    return {
      caseId,
      documentCount: results.length,
      chunkCount: totalChunks,
      retrievalMode,
      embeddingModel: embeddedAny ? embedding?.model : undefined,
      notice,
      documents: results,
    };
  }

  /** Dosyanın indeks durumu — cevaplara "X belgesi indekslenmedi" uyarısı bu veriden gelir. */
  async indexStatus(tenantId: string, caseId: string) {
    const documents = await this.prisma.client.document.findMany({
      where: { tenantId, caseId, deletedAt: null },
      select: {
        id: true,
        name: true,
        ocrStatus: true,
        chunkStatus: true,
        _count: { select: { chunks: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const embeddedChunks = await this.prisma.client.documentChunk.count({
      where: { tenantId, caseId, NOT: { embedding: { isEmpty: true } } },
    });
    const totalChunks = await this.prisma.client.documentChunk.count({
      where: { tenantId, caseId },
    });

    return {
      caseId,
      totalChunks,
      embeddedChunks,
      retrievalMode: embeddedChunks > 0 ? "EMBEDDING" : "KEYWORD",
      documents: documents.map((d) => ({
        documentId: d.id,
        name: d.name,
        ocrStatus: d.ocrStatus,
        chunkStatus: d.chunkStatus,
        chunkCount: d._count.chunks,
      })),
    };
  }

  /**
   * Partileri SINIRLI EŞZAMANLILIKLA koşar ve sonucu GİRDİ SIRASINDA döndürür.
   * (Sıra kritiktir: `vectors[i]` ↔ `maskedContents[i]` eşleşmesi buna dayanır.)
   */
  private async embedInBatches(
    embedding: NonNullable<Awaited<ReturnType<AssistantLlmService["resolveEmbedding"]>>>,
    texts: string[],
  ): Promise<number[][]> {
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      batches.push(texts.slice(i, i + EMBED_BATCH_SIZE));
    }

    const results: number[][][] = new Array(batches.length);
    for (let i = 0; i < batches.length; i += EMBED_CONCURRENCY) {
      const window = batches.slice(i, i + EMBED_CONCURRENCY);
      const settled = await Promise.all(window.map((batch) => this.llm.embed(embedding, batch)));
      settled.forEach((vectors, offset) => {
        results[i + offset] = vectors;
      });
    }
    return results.flat();
  }
}
