/**
 * İZLEME METRİKLERİ (geliştirme planı D3 / C6) — Prometheus metin biçimi.
 *
 * UÇ: GET /metrics  — genel önekten HARİÇTİR (Prometheus standart yolu).
 *
 * GÜVENLİK:
 *   - METRICS_TOKEN tanımlıysa `Authorization: Bearer <token>` zorunludur.
 *   - Üretimde (NODE_ENV=production) token TANIMSIZSA uç 404 döner — metrik
 *     kurulumu tamamlanmamış bir üretim dağıtımı bilgi sızmamalıdır.
 *   - Geliştirme/test ortamında token'sız erişim serbesttir (Prometheus
 *     henüz yokken maliyeti sıfır; Docker healthcheck /health ucunu kullanır).
 *
 * KAPSAM (bilinçli dar): süreç metrikleri + DB erişilebilirliği + birkaç iş
 * sayacı. Histogram'lar ve kuyruk derinliği ilk istekte (müşteri dağıtımında
 * Prometheus kurulunca) eklenir; bu uç ÖLÇÜLEBİLİR bir temel sağlar —
 * "metrik yok" bulgusunu kapatır, abartılı bir gözlem yığını kurmaz.
 */

import { Controller, Get, Header, HttpCode, NotFoundException, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @HttpCode(200)
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async metrics(@Req() request: Request): Promise<string> {
    this.assertAllowed(request);

    const lines: string[] = [];
    const push = (name: string, help: string, type: "gauge" | "counter", value: number) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      lines.push(`${name} ${value}`);
    };

    // --- Süreç metrikleri ---
    const mem = process.memoryUsage();
    push("nomosos_process_uptime_seconds", "API sürecinin çalışma süresi (saniye).", "gauge", process.uptime());
    push("nomosos_process_resident_memory_bytes", "Süreç bellek kullanımı (RSS, bayt).", "gauge", mem.rss);
    push("nomosos_process_heap_used_bytes", "Öbek kullanımı (bayt).", "gauge", mem.heapUsed);

    // --- Veritabanı ---
    const dbStart = Date.now();
    let dbUp = 1;
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
    } catch {
      dbUp = 0;
    }
    const dbMs = (Date.now() - dbStart) / 1000;
    push("nomosos_db_up", "Veritabanı erişimi (1=ayakta, 0=erişilemiyor).", "gauge", dbUp);
    push("nomosos_db_check_duration_seconds", "SELECT 1 ölçüm süresi (saniye).", "gauge", dbMs);

    // --- İş sayaçları (DB ayaktaysa; değilse atlanır — yanlış sıfır basmaz) ---
    if (dbUp === 1) {
      try {
        const [tenants, users, cases] = await Promise.all([
          this.prisma.client.tenant.count(),
          this.prisma.client.user.count({ where: { isActive: true } }),
          this.prisma.client.case.count({ where: { status: "ACIK" } }),
        ]);
        push("nomosos_tenants_total", "Kayıtlı büro (kiracı) sayısı.", "gauge", tenants);
        push("nomosos_users_active_total", "Aktif kullanıcı sayısı.", "gauge", users);
        push("nomosos_cases_open_total", "ACIK durumdaki dosya sayısı.", "gauge", cases);
      } catch {
        // Sayaçlar opsiyoneldir; süreç/DB metrikleri yeter.
      }
    }

    return `${lines.join("\n")}\n`;
  }

  /** Token kapısı — üretimde tanımsızsa uç VAROLMAZ (404). */
  private assertAllowed(request: Request): void {
    const token = process.env.METRICS_TOKEN?.trim();
    if (!token) {
      if (process.env.NODE_ENV === "production") {
        throw new NotFoundException();
      }
      return; // geliştirme/test: serbest
    }
    const header = request.headers.authorization;
    if (header !== `Bearer ${token}`) {
      throw new UnauthorizedException("Metrik erişimi için geçerli taşıyıcı belirteç gerekir.");
    }
  }
}
