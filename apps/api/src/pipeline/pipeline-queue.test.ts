/**
 * F2 · B1 (İLK KESİT) REGRESYON TESTİ — belge hattı asenkron kuyruğu.
 *
 * Korunan taahhütler:
 *  1. YUMUŞAK DÜŞÜŞ: kuyruk yoksa `enqueue` false döner; belge yükleme
 *     Redise SERT bağımlı hale gelmez (zamanlayıcı ilkesi).
 *  2. Kuyruk yazımı düşerse (Redis kopması) çağılan YİNE senkron düşer.
 *  3. DLQ: son denemede düşen iş CALISIYOR'da takılan koşumu BASARISIZ'a çeker.
 *  4. Yükleme ve yeniden oynatma yollarının İKİSİ de kuyruğa gider.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PipelineQueueService } from "./pipeline-queue.service";
import type { PipelineService } from "./pipeline.service";
import type { PrismaService } from "../prisma/prisma.service";

function serviceWith(over: { pipeline?: Partial<PipelineService>; prisma?: object }) {
  const pipeline = {
    run: over.pipeline?.run ?? (async () => ({ runId: null, status: "TAMAM", proposalCount: 0 })),
    ...over.pipeline,
  } as PipelineService;
  const prisma = {
    client: {
      pipelineRun: {
        findFirst: over.prisma ?? (async () => ({ id: "run-1" })),
        update: async () => ({}),
      },
    },
  } as unknown as PrismaService;
  return { prisma, svc: new PipelineQueueService(prisma, pipeline) };
}

describe("B1: yumuşak düşüş — kuyruk yoksa senkron", () => {
  it("onModuleInit Redis kapalıysa kuyruk KURULMAZ ve enqueue false döner", async () => {
    const { svc } = serviceWith({});
    // REDIS_URL tanımsız ortamda worker kurulmaz.
    const before = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      await svc.onModuleInit();
      const res = await svc.enqueue({ tenantId: "t1", documentId: "d1" });
      expect(res).toEqual({ queued: false });
    } finally {
      if (before !== undefined) process.env.REDIS_URL = before;
    }
  });

  it("kuyruk yazımı düşerse (add hata) enqueue yine false döner", async () => {
    const { svc } = serviceWith({});
    // Kuyruk alanını zorla 'var ama bozuk' duruma sok.
    (svc as unknown as { queue: unknown }).queue = {
      add: async () => {
        throw new Error("bağlantı koptu");
      },
    };
    const res = await svc.enqueue({ tenantId: "t1", documentId: "d1" });
    expect(res).toEqual({ queued: false });
  });

  it("stats kuyruk kapalıyken enabled=false döner", async () => {
    const { svc } = serviceWith({});
    const stats = await svc.stats();
    expect(stats.enabled).toBe(false);
  });
});

describe("B1: DLQ — takılan koşum BASARISIZ'a çekilir", () => {
  it("markStuckRunFailed CALISIYOR satırını günceller", async () => {
    const updates: { id: string; status: string }[] = [];
    const prisma = {
      client: {
        pipelineRun: {
          findFirst: async () => ({ id: "run-9" }),
          update: async (args: { where: { id: string }; data: { status: string } }) => {
            updates.push({ id: args.where.id, status: args.data.status });
            return {};
          },
        },
      },
    } as unknown as PrismaService;
    const fresh = new PipelineQueueService(prisma, {} as PipelineService);

    // Özel yöntem özel çağrılır (DLQ işleyicisi 'failed' olayından çağırır).
    await (fresh as unknown as { markStuckRunFailed: (d: object, m: string) => Promise<void> }).markStuckRunFailed(
      { tenantId: "t1", documentId: "d1" },
      "sağlayıcı yanıt vermedi",
    );
    expect(updates).toEqual([{ id: "run-9", status: "BASARISIZ" }]);
  });
});

describe("B1: kaynak taahhüdü — yolların ikisi de kuyruğa gider", () => {
  const docs = readFileSync(join(process.cwd(), "src", "documents", "documents.service.ts"), "utf-8");

  it("yükleme yolunda enqueue + senkron yedek var", () => {
    expect(docs).toContain("this.pipelineQueue.enqueue(");
    expect(docs).toContain('status: "KUYRUKTA"');
    // Senkron yedek: kuyruk false dönerse pipeline.run çağrılır.
    expect(docs).toMatch(/else\s*\{[\s\S]*?this\.pipeline\.run\(/);
  });

  it("yeniden oynatma (reprocess) da kuyruğa gider", () => {
    const reprocessBody = docs.slice(docs.indexOf("async reprocess("));
    expect(reprocessBody).toContain("pipelineQueue.enqueue");
  });

  it("kuyruk servisi yeniden deneme politikası taşır (3 deneme, üstel)", () => {
    const queue = readFileSync(join(process.cwd(), "src", "pipeline", "pipeline-queue.service.ts"), "utf-8");
    expect(queue).toContain("attempts: 3");
    expect(queue).toContain('backoff: { type: "exponential", delay: 5_000 }');
    // DLQ: başarısız işler silinmez — incelenebilir kalır.
    expect(queue).toContain("removeOnFail: 500");
    expect(queue).toContain("markStuckRunFailed");
  });

  it("modül kuyruk servisini dışa açıyor (DocumentsModule enjekte edebilir)", () => {
    const module = readFileSync(join(process.cwd(), "src", "pipeline", "pipeline.module.ts"), "utf-8");
    expect(module).toContain("PipelineQueueService");
  });
});
