/**
 * PLATFORM DEMO TALEPLERİ — tanıtım sitesi demo taleplerinin YÖNETİM PANELİ
 * TARAFI (kullanıcı kararı: talep e-posta/webhook GÖNDERİLMEZ, kayıt olarak
 * düşer ve buradan takip edilir).
 *
 * Okuma: demoRequests.view (tüm okuma rolleri). Durum değişimi:
 * demoRequests.update (OPS_ADMIN+). ANALYST_READONLY hiçbir koşulda göremez —
 * satış hattı verisi.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import type { PlatformAuthUser } from "../platform.types";

export const DEMO_REQUEST_STATUSES = ["YENI", "ILETISIME_GECILDI", "KAPANDI"] as const;
export type DemoRequestStatus = (typeof DEMO_REQUEST_STATUSES)[number];

@Injectable()
export class PlatformDemoRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /** GET /platform/demo-requests — sayfalı liste + sayaçlar. */
  async list(query: { status?: string; page?: string; limit?: string }) {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 200);
    const page = Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1);
    const where: Prisma.DemoRequestWhereInput = {};
    if (query.status && DEMO_REQUEST_STATUSES.includes(query.status as DemoRequestStatus)) {
      where.status = query.status;
    }

    const [rows, total, yeniSayi] = await Promise.all([
      this.prisma.client.demoRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.demoRequest.count({ where }),
      this.prisma.client.demoRequest.count({ where: { status: "YENI" } }),
    ]);

    return { rows, total, page, limit, yeniSayi };
  }

  /** PATCH /platform/demo-requests/:id — durum güncelleme (iz kaydıyla). */
  async updateStatus(user: PlatformAuthUser, id: string, status: DemoRequestStatus) {
    const existing = await this.prisma.client.demoRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Demo talebi bulunamadı.");

    const row = await this.prisma.client.demoRequest.update({
      where: { id },
      data: { status, statusChangedBy: user.id, statusChangedAt: new Date() },
    });

    await this.audit.log({
      actor: user,
      action: "DEMO_REQUEST_STATUS",
      entity: "DemoRequest",
      entityId: id,
      detail: `${existing.status} → ${status}`,
    });

    return row;
  }
}
