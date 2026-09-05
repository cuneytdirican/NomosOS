import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { ReadinessService } from "./readiness.service";

/**
 * SAĞLIK UÇLARI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BU UÇLAR HİÇBİR İŞ KURALINA TABİ DEĞİLDİR — ne bakım kilidine, ne        ║
 * ║ abonelik durumuna, ne kimliğe. Süreç ayakta mı, onu söylerler.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Denetim bulgusu K-02: `TenantStatusGuard` bakım tam kilidini `@Public()`
 * kontrolünden ÖNCE uyguluyordu ve `/health` de 503 dönüyordu. Guard'daki sıra
 * düzeltildi; `/health/live` İKİNCİ savunma katmanıdır: konteyner healthcheck'i
 * buna bağlanır ve hiçbir bağımlılığa bakmaz.
 *
 * Faz 4: `/health/ready` bağımlılık yoklaması (DB/Redis/S3) — yük dengeleyici ve
 * rolling update bu uca bakar; biri düşükse 503 + hangi bağımlılık.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Public()
  @Get()
  check(): { status: string; time: string } {
    return { status: "ok", time: new Date().toISOString() };
  }

  /** LIVENESS — süreç ayakta mı? Veritabanı/Redis çağrısı YAPMAZ. */
  @Public()
  @Get("live")
  live(): { status: string; time: string } {
    return { status: "ok", time: new Date().toISOString() };
  }

  /** READINESS — DB + Redis + S3 gerçek yoklama; biri düşükse 503. */
  @Public()
  @Get("ready")
  async ready() {
    const report = await this.readiness.check();
    if (report.status !== "ready") throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
