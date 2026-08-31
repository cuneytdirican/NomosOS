/**
 * F2 · B1 (İLK KESİT) — BELGE HATTI ASYNKRON KUYRUĞU.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║ TASARIM KARARI: REDIS YOKSA HAT SENKRON ÇALIŞMAYA DEVAM EDER.          ║
 * ║                                                                        ║
 * ║ Zamanlayıcının YUMUŞAK BAĞIMLILIK ilkesi burada da geçerli (bkz.      ║
 * ║ scheduler/redis-connection.ts): Redis kapalıyken belge yüklemek         ║
 * ║ ÇALIŞMAZ hâle gelmemeli. `enqueue()` kuyruk kapalıysa `queued: false`  ║
 * ║ döner; çağıran SENKRON yolla işler (eski davranış). Kuyruk açıksa      ║
 * ║ istek anında kabul edilir ve Worker üç denemeye kadar yeniden dener.   ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * YENİDEN DENEME (B1): altyapısal arızalar (Redis kopması, depo okuma hatası)
 * için 3 deneme, üstel geri çekilme (5 sn → 10 sn → 20 sn).
 *
 * DLQ SEMANTİĞİ (B1): son denemede de düşen iş "kaybolmaz" — BullMQ failed
 * setinde kalır (removeOnFail: 500), CALISIYOR'da takılı kalan PipelineRun
 * satırı BASARISIZ'a çekilir ve hata günlüğe yazılır. Toplu yeniden deneme
 * ucu sonraki kesitte gelir.
 *
 * KISMİ BAŞARISIZLIK: PipelineService.run adımları zaten tek tek yakalar
 * (kural 2 — bir adım düşerse hat durmaz); kuyruk bu semantiği DEĞİŞTİRMEZ,
 * yalnızca ÇAĞRININ zamanını taşır.
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { resolveRedisConfig } from "../scheduler/redis-connection";
import { PipelineService } from "./pipeline.service";

/** Kuyruk adı — BullMQ'da kuyruk kimliğidir. */
export const PIPELINE_QUEUE_NAME = "document-pipeline";

/** Eşzamanlı işlenen belge sayısı — CPU ve dış sağlayıcı baskısını sınırlar. */
export const PIPELINE_CONCURRENCY = 2;

export interface PipelineJobData {
  tenantId: string;
  userId?: string;
  documentId: string;
}

export interface EnqueueResult {
  /** true: kuyruğa alındı (asenkron). false: kuyruk kapalı — senkron işlenmeli. */
  queued: boolean;
  jobId?: string;
}

@Injectable()
export class PipelineQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineQueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = resolveRedisConfig();
    if (!config.enabled) {
      // Yumuşak düşüş: senkron mod, uyarıyla loglanır (zamanlayıcı deseni).
      this.logger.warn(
        `Belge hattı kuyruğu KURULMADI (${config.reason ?? "Redis kapalı"}) — ` +
          "belgeler yüklenme isteği içinde (senkron) işlenecek."
      );
      return;
    }

    const connection = { ...config.options };
    this.queue = new Queue(PIPELINE_QUEUE_NAME, { connection });
    this.worker = new Worker<PipelineJobData>(
      PIPELINE_QUEUE_NAME,
      async (job: Job<PipelineJobData>) => {
        const result = await this.pipeline.run(job.data);
        this.logger.log(
          `Belge hattı koştu (kuyruk, belge ${job.data.documentId}, deneme ${job.attemptsMade + 1}): ` +
            `durum=${result.status} öneri=${result.proposalCount}`
        );
        return result;
      },
      {
        connection,
        concurrency: PIPELINE_CONCURRENCY,
        // Worker kapanışı: onModuleDestroy'un 10 sn içinde bitmesi için
        // bekleyen işler tamamlanır, yeni iş alınmaz.
        runRetryDelay: 1_000,
      },
    );

    this.worker.on("failed", async (job, err) => {
      const isFinal = job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1);
      if (!isFinal || !job) return;
      // DLQ: son denemede de düşen iş kaybolmaz — iz kalır ve hat kapanır.
      this.logger.error(
        `Belge hattı ${job.opts.attempts} denemede başarısız (belge ${job.data.documentId}): ${err.message}`
      );
      await this.markStuckRunFailed(job.data, err.message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Belge hattı işini kuyruğa verir. Kuyruk kapalıysa `queued: false` döner;
   * çağıran SENKRON işler — belge yükleme Redise bağımlı hâle gelmez.
   */
  async enqueue(data: PipelineJobData): Promise<EnqueueResult> {
    if (!this.queue) return { queued: false };
    try {
      const job = await this.queue.add("run", data, {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      return { queued: true, jobId: job.id ?? undefined };
    } catch (err) {
      // Kuyruk yazımı düşerse (Redis kopması gibi) belge kaybolmasın:
      // çağıran senkron düşer.
      this.logger.warn(
        `Kuyruğa yazılamadı, senkron düşülüyor (belge ${data.documentId}): ${(err as Error).message}`
      );
      return { queued: false };
    }
  }

  /**
   * Kuyrukta bekleyen/işlenen iş durumu — canlılık gözlemi ve testler için.
   */
  async stats(): Promise<{ enabled: boolean; waiting: number; active: number; failed: number }> {
    if (!this.queue) return { enabled: false, waiting: 0, active: 0, failed: 0 };
    const counts = await this.queue.getJobCounts("waiting", "active", "failed");
    return {
      enabled: true,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
    };
  }

  /** CALISIYOR'da takılı kalan son koşumu BASARISIZ'a çeker (DLQ izi). */
  private async markStuckRunFailed(data: PipelineJobData, message: string): Promise<void> {
    try {
      const stuck = await this.prisma.client.pipelineRun.findFirst({
        where: { documentId: data.documentId, status: "CALISIYOR" },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      if (!stuck) return;
      await this.prisma.client.pipelineRun.update({
        where: { id: stuck.id },
        data: {
          status: "BASARISIZ",
          finishedAt: new Date(),
          errorMessage: `Kuyruk denemeleri tükendi: ${message}`.slice(0, 500),
        },
      });
    } catch (err) {
      this.logger.error(
        `Takılan koşum işaretlenemedi (belge ${data.documentId}): ${(err as Error).message}`
      );
    }
  }
}
