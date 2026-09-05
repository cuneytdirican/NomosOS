/**
 * İZLEME METRİKLERİ — Prometheus metin biçimi (Faz 4: prom-client kayıt defteri).
 *
 * UÇ: GET /metrics — genel önekten HARİÇTİR (Prometheus standart yolu).
 *
 * GÜVENLİK:
 *   - METRICS_TOKEN tanımlıysa `Authorization: Bearer <token>` zorunludur.
 *   - Üretimde (NODE_ENV=production) token TANIMSIZSA uç 404 döner.
 *   - Geliştirme/test ortamında token'sız erişim serbesttir.
 *
 * Kazıma anında (scrape) yenilenen iş göstergeleri: DB erişimi, kiracı/kullanıcı/dosya
 * sayıları, abonelik durumları, vadesi geçmiş platform faturaları, eksi bakiyeli
 * cüzdanlar, kuyruk derinliği (BullMQ varsa), yedek tazeliği. Sayaç/histogramlar istek
 * ve iş akışı sırasında dolar (`metrics.registry.ts`).
 */

import { Controller, Get, Header, HttpCode, NotFoundException, Optional, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { PipelineQueueService } from "../pipeline/pipeline-queue.service";
import {
  casesOpen,
  creditWalletsNegative,
  dbCheckDuration,
  dbUp,
  platformInvoicesOverdue,
  queueJobs,
  renderMetrics,
  subscriptionsByStatus,
  tenantsTotal,
  usersActive,
} from "./metrics.registry";

const SUBSCRIPTION_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"] as const;

@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly queue?: PipelineQueueService,
  ) {}

  @Public()
  @Get()
  @HttpCode(200)
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async metrics(@Req() request: Request): Promise<string> {
    this.assertAllowed(request);
    await this.refreshGauges();
    return renderMetrics();
  }

  /** Kazıma anında yenilenen göstergeler; DB kapalıysa iş sayaçları dokunulmaz (yanlış sıfır basmaz). */
  async refreshGauges(): Promise<void> {
    const start = Date.now();
    let up = 1;
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
    } catch {
      up = 0;
    }
    dbUp.set(up);
    dbCheckDuration.set((Date.now() - start) / 1000);

    if (up === 1) {
      try {
        const now = new Date();
        const [tenants, users, cases, subs, overdue, negative] = await Promise.all([
          this.prisma.client.tenant.count(),
          this.prisma.client.user.count({ where: { isActive: true } }),
          this.prisma.client.case.count({ where: { status: "ACIK" } }),
          this.prisma.client.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
          this.prisma.client.invoiceRecord.count({ where: { status: { in: ["GONDERILDI", "KISMI_ODENDI"] }, dueDate: { lt: now } } }),
          this.prisma.client.$queryRaw<Array<{ n: bigint | number }>>`SELECT COUNT(*)::int AS n FROM "CreditWallet" WHERE ("includedCredits" - "includedConsumed" + "purchasedCredits" - "reservedCredits") < 0`,
        ]);
        tenantsTotal.set(tenants);
        usersActive.set(users);
        casesOpen.set(cases);
        const counts = new Map(subs.map((s) => [s.status, s._count._all]));
        for (const st of SUBSCRIPTION_STATUSES) subscriptionsByStatus.labels(st).set(counts.get(st) ?? 0);
        platformInvoicesOverdue.set(overdue);
        creditWalletsNegative.set(Number(negative[0]?.n ?? 0));
      } catch {
        // Sayaçlar opsiyoneldir; süreç/DB metrikleri yeter.
      }
    }

    if (this.queue) {
      try {
        const s = await this.queue.stats();
        queueJobs.labels("waiting").set(s.waiting);
        queueJobs.labels("active").set(s.active);
        queueJobs.labels("failed").set(s.failed);
      } catch {
        /* kuyruk kapalı */
      }
    }
  }

  /** Token kapısı — üretimde tanımsızsa uç VAROLMAZ (404). */
  private assertAllowed(request: Request): void {
    const token = process.env.METRICS_TOKEN?.trim();
    if (!token) {
      if (process.env.NODE_ENV === "production") throw new NotFoundException();
      return;
    }
    const header = request.headers.authorization;
    if (header !== `Bearer ${token}`) {
      throw new UnauthorizedException("Metrik erişimi için geçerli taşıyıcı belirteç gerekir.");
    }
  }
}
