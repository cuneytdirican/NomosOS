import { Injectable, Logger } from "@nestjs/common";
import { connect } from "node:net";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../../storage/storage.service";

export interface ComponentHealth {
  component: string;
  status: "ok" | "degraded" | "down";
  latencyMs: number | null;
  detail: string;
}

/** Tek bir bağımlılık kontrolüne tanınan azami süre (ms). */
const PROBE_TIMEOUT_MS = 2500;

/**
 * SİSTEM SAĞLIĞI — GERÇEK BAĞLANTI DENEMESİ.
 *
 * Bu uç sabit `{status:"ok"}` DÖNDÜRMEZ. Sağlık panosunun tek işi, bir şey
 * bozulduğunda bunu söylemektir; uydurma "ok", panoyu işe yaramaz hâle
 * getirmenin ötesinde zararlıdır — arıza anında operasyonu yanlış yöne
 * sürükler. Üç bağımlılığın her biri gerçekten yoklanır:
 *
 *   - PostgreSQL: `SELECT 1` (Prisma üzerinden),
 *   - Redis: ham TCP + `PING` → `+PONG` (yeni bağımlılık eklemeden; API
 *     paketine bu fazda paket eklenemiyor),
 *   - S3/MinIO: kova varlık kontrolü (mevcut S3 istemcisiyle).
 *
 * Panel bir APM DEĞİLDİR (spec §Analitik): derin metrikler Prometheus/Grafana
 * tarafındadır, burada yalnızca "ayakta mı" sorusu yanıtlanır.
 */
@Injectable()
export class PlatformHealthService {
  private readonly logger = new Logger(PlatformHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  async check(): Promise<{
    status: "ok" | "degraded" | "down";
    checkedAt: string;
    uptimeSeconds: number;
    components: ComponentHealth[];
  }> {
    const components = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
    ]);

    const down = components.filter((c) => c.status === "down").length;
    const status: "ok" | "degraded" | "down" =
      down === components.length ? "down" : down > 0 ? "degraded" : "ok";

    return {
      status,
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      components,
    };
  }

  /** ANALYST_READONLY için yalnız uptime satırı (matris: system.health.uptime 🔒). */
  uptimeOnly() {
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      checkedAt: new Date().toISOString(),
      note:
        "Analist (salt-okur) rolü yalnızca çalışma süresi satırını görür; bileşen " +
        "ayrıntıları ve hata mesajları bu role kapalıdır.",
    };
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const started = Date.now();
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return {
        component: "postgresql",
        status: "ok",
        latencyMs: Date.now() - started,
        detail: "Bağlantı ve sorgu başarılı.",
      };
    } catch (err) {
      this.logger.error(`PostgreSQL sağlık kontrolü başarısız: ${(err as Error).message}`);
      return {
        component: "postgresql",
        status: "down",
        latencyMs: Date.now() - started,
        // Ham hata istemciye verilmez (bağlantı dizesi/parola sızabilir).
        detail: "Veritabanına ulaşılamıyor. Ayrıntı sunucu günlüğündedir.",
      };
    }
  }

  /**
   * Redis PING — ham TCP.
   *
   * `ioredis` gibi bir istemci eklemek `apps/api/package.json`'a dokunmayı
   * gerektirirdi; bu dosya bu fazda başka bir ajanın sahipliğindedir. RESP
   * protokolünde `PING` tek satırdır ve yanıtı `+PONG`'dur — kontrol için
   * fazlası gerekmez.
   */
  private checkRedis(): Promise<ComponentHealth> {
    const started = Date.now();
    const { host, port } = parseRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379");

    return new Promise<ComponentHealth>((resolve) => {
      let settled = false;
      const finish = (status: ComponentHealth["status"], detail: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({ component: "redis", status, latencyMs: Date.now() - started, detail });
      };

      const socket = connect({ host, port });
      socket.setTimeout(PROBE_TIMEOUT_MS);
      socket.on("connect", () => socket.write("PING\r\n"));
      socket.on("data", (chunk) => {
        const reply = chunk.toString("utf8");
        if (reply.startsWith("+PONG")) {
          finish("ok", "PING → PONG.");
        } else if (reply.startsWith("-NOAUTH") || reply.startsWith("-ERR")) {
          // Sunucu ayakta ama kimlik doğrulama istiyor: "down" değil "degraded".
          finish("degraded", "Redis yanıt veriyor ancak kimlik doğrulama gerekiyor.");
        } else {
          finish("degraded", "Beklenmeyen Redis yanıtı.");
        }
      });
      socket.on("timeout", () => finish("down", `Redis zaman aşımı (${PROBE_TIMEOUT_MS} ms).`));
      socket.on("error", () => finish("down", `Redis'e bağlanılamadı (${host}:${port}).`));
    });
  }

  /**
   * S3/MinIO kova kontrolü.
   *
   * `ensureBucket()` önce HeadBucket dener; kova yoksa oluşturur. Uygulama
   * açılışında zaten çağrıldığı için normal işletimde bu yalnızca bir okuma
   * turudur ve gerçek bir ağ gidiş-dönüşü yapar.
   */
  private async checkStorage(): Promise<ComponentHealth> {
    const started = Date.now();
    try {
      await this.storage.ensureBucket();
      return {
        component: "s3",
        status: "ok",
        latencyMs: Date.now() - started,
        detail: `Kova erişilebilir: ${this.storage.bucket}`,
      };
    } catch (err) {
      this.logger.error(`S3 sağlık kontrolü başarısız: ${(err as Error).message}`);
      return {
        component: "s3",
        status: "down",
        latencyMs: Date.now() - started,
        detail: "Belge deposuna ulaşılamıyor. Ayrıntı sunucu günlüğündedir.",
      };
    }
  }
}

/** `redis://[:parola@]host:port[/db]` → { host, port } */
export function parseRedisUrl(url: string): { host: string; port: number } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "localhost",
      port: Number.parseInt(parsed.port || "6379", 10),
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}
