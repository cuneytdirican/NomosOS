import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import type { AssistantLlmService } from "./assistant-llm.service";
import { RetrievalService, vectorBackend } from "./retrieval.service";

function build(opts: { raw?: (sql: string) => Promise<unknown[]>; backend?: "pgvector" | "js" }) {
  process.env.RAG_VECTOR_BACKEND = opts.backend ?? "pgvector";
  const jsRows = [
    { id: "c1", documentId: "d1", sourceLabel: "A · parça 1", content: "fesih bildirimi", embedding: [1, 0, 0], embeddingModel: "m" },
    { id: "c2", documentId: "d1", sourceLabel: "A · parça 2", content: "başka", embedding: [0, 1, 0], embeddingModel: "m" },
  ];
  const queryRawUnsafe = vi.fn(async (sql: string) => (opts.raw ? opts.raw(sql) : []));
  const prisma = {
    client: {
      documentChunk: { count: vi.fn(async () => 2), findMany: vi.fn(async () => jsRows) },
      $queryRawUnsafe: queryRawUnsafe,
    },
  } as unknown as PrismaService;
  const llm = {
    resolveEmbedding: vi.fn(async () => ({ model: "m", config: {}, providerConfigId: "p", providerType: "OPENAI_COMPAT" })),
    embed: vi.fn(async () => [[1, 0, 0]]),
  } as unknown as AssistantLlmService;
  return { svc: new RetrievalService(prisma, llm), queryRawUnsafe, prisma };
}

describe("RetrievalService — pgvector yolu", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("vectorBackend: varsayılan pgvector; js bayrağı", () => {
    expect(vectorBackend({} as NodeJS.ProcessEnv)).toBe("pgvector");
    expect(vectorBackend({ RAG_VECTOR_BACKEND: "JS" } as NodeJS.ProcessEnv)).toBe("js");
  });

  it("pgvector sorgusu: boyuta cast, LIMIT k, skor 1−uzaklık; sonuçlar veritabanından gelir", async () => {
    const b = build({ raw: async () => [{ id: "c1", documentId: "d1", sourceLabel: "A · parça 1", content: "fesih bildirimi", score: "0.91" }] });
    const r = await b.svc.retrieveContext("t1", "k1", "fesih", { topK: 3 });
    expect(r.mode).toBe("EMBEDDING");
    expect(r.chunks[0]).toMatchObject({ chunkId: "c1", score: 0.91 });
    const sql = String((b.queryRawUnsafe.mock.calls[0] as unknown[])[0]);
    expect(sql).toContain("::vector(3)");
    expect(sql).toContain("<=>");
    expect(sql).toContain("LIMIT 3");
    expect(sql).toContain('"embeddingDim" = 3');
    expect((b.prisma.client.documentChunk.findMany as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("pgvector hata verirse (uzantı yok) JS kosinüs yoluna düşer; js bayrağında hiç DB sorgusu yok", async () => {
    const b = build({ raw: async () => { throw new Error('column "embeddingVec" does not exist'); } });
    const r = await b.svc.retrieveContext("t1", "k1", "fesih", { topK: 2 });
    expect(r.mode).toBe("EMBEDDING");
    expect(r.chunks[0].chunkId).toBe("c1"); // JS kosinüs: [1,0,0] ↔ [1,0,0]
    expect(b.queryRawUnsafe).toHaveBeenCalledTimes(1);

    const c = build({ backend: "js" });
    await c.svc.retrieveContext("t1", "k1", "fesih", { topK: 2 });
    expect(c.queryRawUnsafe).not.toHaveBeenCalled();
  });
});
