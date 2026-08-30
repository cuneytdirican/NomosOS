import { Get, HttpCode, Post, Query } from "@nestjs/common";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformMetricsService } from "./platform-metrics.service";
import { UsageSnapshotService } from "./usage-snapshot.service";

/** `/api/admin/v1/metrics` */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/metrics`)
export class PlatformMetricsController {
  constructor(
    private readonly metrics: PlatformMetricsService,
    private readonly snapshots: UsageSnapshotService
  ) {}

  /** Platform KPI'ları. ANALYST_READONLY buraya giremez → /metrics/investor. */
  @Get("overview")
  @ReadPermission("metrics.overview.view")
  overview() {
    return this.metrics.overview();
  }

  /** UsageSnapshot zaman serisi (tenantId verilmezse gün bazında toplulaştırılır). */
  @Get("usage")
  @ReadPermission("tenant.usage.view")
  usage(@Query() query: { from?: string; to?: string; tenantId?: string }) {
    return this.metrics.usage(query);
  }

  /** AI kırılımı: tenant | taskType | provider | model. */
  @Get("ai")
  @ReadPermission("ai.analytics.platform")
  ai(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Query() query: { groupBy?: string; from?: string; to?: string; tenantId?: string }
  ) {
    return this.metrics.ai(user, query);
  }

  /**
   * KURUL RAPORU — ANALYST_READONLY rolünün TEK veri ucu.
   * Yanıt tenant kimliği ve kişisel veri içermez (kolon beyaz listesi).
   */
  @Get("investor")
  @ReadPermission("board_report.view")
  investor(@CurrentPlatformUser() user: PlatformAuthUser) {
    return this.metrics.investor(user);
  }

  /**
   * Günlük kullanım fotoğrafını ELLE tetikler (idempotent).
   * Gerçek gece cron'u Faz 6'da BullMQ ile bağlanacak; çağıracağı metot aynıdır.
   */
  @Post("snapshot/run")
  @HttpCode(200)
  @WritePermission("system.settings")
  async runSnapshot(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Query("date") date?: string
  ) {
    const target = date ? new Date(date) : undefined;
    if (target && Number.isNaN(target.getTime())) {
      return { error: "Geçersiz tarih. Biçim: YYYY-MM-DD" };
    }
    const result = await this.snapshots.collectDaily(target);
    await this.metrics.logSnapshotRun(user, result);
    return {
      ...result,
      message:
        `${result.date} günü için ${result.written} büro fotoğrafı yazıldı. İşlem idempotenttir; ` +
        "aynı gün için tekrar çalıştırmak mükerrer satır üretmez.",
    };
  }
}
