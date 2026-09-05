/**
 * READINESS (Faz 4) — `GET /health/ready`: bağımlılıklar gerçekten hazır mı?
 *
 * Liveness (`/health/live`) yalnız "süreç ayakta" der; readiness DB, Redis ve S3'e
 * gerçek istek atar ve biri kritik olarak düşükse 503 döner. Yük dengeleyici /
 * dağıtım (rolling update) yeni örneği trafiğe bu uç 200 dönünce alır.
 *
 *  - postgres: `SELECT 1` (kritik)
 *  - redis:    REDIS_URL tanımlıysa PING (kritik; tanımsızsa "devre dışı", sağlığı etkilemez)
 *  - s3:       HeadBucket (kritik: belge yükleme/indirme buna bağlı)
 * Her yoklama 2 sn zaman aşımlı; yanıt bağımlılık başına durum + süre verir.
 */

import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { sharedRateLimitRedis } from "../common/rate-limit/shared-redis";

export interface DependencyCheck {
  status: "up" | "down" | "disabled";
  durationMs: number;
  detail?: string;
}

export interface ReadinessReport {
  status: "ready" | "degraded";
  time: string;
  checks: { postgres: DependencyCheck; redis: DependencyCheck; s3: DependencyCheck };
}

const TIMEOUT_MS = 2000;

async function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} zaman aşımı (${TIMEOUT_MS} ms)`)), TIMEOUT_MS))]);
}

async function probe(fn: () => Promise<void>, label: string): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await withTimeout(fn(), label);
    return { status: "up", durationMs: Date.now() - start };
  } catch (err) {
    return { status: "down", durationMs: Date.now() - start, detail: (err as Error).message.slice(0, 160) };
  }
}

@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  async check(): Promise<ReadinessReport> {
    const [postgres, redis, s3] = await Promise.all([this.checkPostgres(), this.checkRedis(), this.checkS3()]);
    const critical = [postgres, redis, s3].some((c) => c.status === "down");
    return { status: critical ? "degraded" : "ready", time: new Date().toISOString(), checks: { postgres, redis, s3 } };
  }

  private checkPostgres(): Promise<DependencyCheck> {
    return probe(async () => {
      await this.prisma.client.$queryRaw`SELECT 1`;
    }, "postgres");
  }

  private async checkRedis(): Promise<DependencyCheck> {
    if (!process.env.REDIS_URL?.trim()) return { status: "disabled", durationMs: 0, detail: "REDIS_URL tanımsız" };
    let client: { ping: () => Promise<string>; connect?: () => Promise<void>; status?: string } | null = null;
    try {
      client = sharedRateLimitRedis().client as typeof client;
    } catch (err) {
      return { status: "down", durationMs: 0, detail: (err as Error).message.slice(0, 160) };
    }
    if (!client) return { status: "disabled", durationMs: 0, detail: "Redis istemcisi çözülemedi" };
    const c: { ping: () => Promise<string>; connect?: () => Promise<void>; status?: string } = client;
    return probe(async () => {
      if (c.status === "wait" && c.connect) await c.connect();
      const pong = await c.ping();
      if (pong !== "PONG") throw new Error(`beklenmeyen yanıt: ${pong}`);
    }, "redis");
  }

  private checkS3(): Promise<DependencyCheck> {
    if (!this.storage) return Promise.resolve({ status: "disabled", durationMs: 0, detail: "StorageService yok" });
    return probe(async () => {
      await this.storage!.ensureBucket();
    }, "s3");
  }
}
