import { Injectable } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { normalizeQuery, paged, resolvePage } from "../../common/pagination";
import { buildDateRange } from "../tenants/platform-tenants.service";
import type { PlatformAuthUser } from "../platform.types";

/**
 * ROL BAZLI DENETİM İZİ KAPSAMLARI.
 *
 * Matris "PlatformAuditLog görüntüle" satırını rollere göre kısıtlar:
 *   SUPER_ADMIN   ✅ hepsi
 *   OPS_ADMIN     👁 kendi alanı (tenant/abonelik/sistem/duyuru/destek)
 *   BILLING_ADMIN 👁 finans kayıtları (ödeme/fatura/plan/abonelik)
 *   SUPPORT_AGENT 👁 kendi işlemleri (yalnız kendi satırları)
 *   ANALYST       ❌ (guard'da kesilir)
 *
 * Kapsam ÖNEK LİSTESİYLE tanımlıdır; yeni bir aksiyon adı eklendiğinde hiçbir
 * öneke uymuyorsa yalnız SUPER_ADMIN görür — yine fail-closed.
 */
const DOMAIN_PREFIXES: Record<string, readonly string[]> = {
  OPS_ADMIN: [
    "TENANT_",
    "SUBSCRIPTION_",
    "SETTING_",
    "SYSTEM_",
    "FLAG_",
    "ANNOUNCEMENT_",
    "SUPPORT_",
    "USAGE_SNAPSHOT_",
    "APPROVAL_",
  ],
  BILLING_ADMIN: ["PAYMENT_", "INVOICE_", "PLAN_", "SUBSCRIPTION_", "APPROVAL_"],
};

@Injectable()
export class PlatformAuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: PlatformAuthUser,
    query: {
      platformUserId?: string;
      tenantId?: string;
      action?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    }
  ) {
    const where: Prisma.PlatformAuditLogWhereInput = {};

    if (query.platformUserId) where.platformUserId = query.platformUserId;
    if (query.tenantId) where.tenantId = query.tenantId;
    const action = normalizeQuery(query.action);
    if (action) where.action = { contains: action.toUpperCase() };
    const range = buildDateRange(query);
    if (range) where.createdAt = range;

    // --- rol kapsamı (kullanıcının verdiği süzgeçlerin ÜSTÜNE eklenir) ---
    if (user.role === "SUPPORT_AGENT") {
      where.platformUserId = user.id;
    } else if (user.role !== "SUPER_ADMIN") {
      const prefixes = DOMAIN_PREFIXES[user.role] ?? [];
      where.OR = [
        // Kendi işlemlerini her rol görür.
        { platformUserId: user.id },
        ...prefixes.map((prefix) => ({ action: { startsWith: prefix } })),
      ];
    }

    const page = resolvePage(query);
    const [rows, total] = await Promise.all([
      this.prisma.client.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: {
          platformUser: { select: { id: true, fullName: true, email: true, role: true } },
        },
      }),
      this.prisma.client.platformAuditLog.count({ where }),
    ]);

    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((v): v is string => !!v))];
    const tenants = tenantIds.length
      ? await this.prisma.client.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true },
        })
      : [];
    const tenantNames = new Map(tenants.map((t) => [t.id, t.name]));

    return {
      ...paged(
        rows.map((r) => ({
          id: r.id,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          tenantId: r.tenantId,
          // Kiracı silinmiş olabilir: platform tablolarında tenantId FK DEĞİLDİR,
          // iz bilerek ayakta bırakılır.
          tenantName: r.tenantId ? tenantNames.get(r.tenantId) ?? "(silinmiş büro)" : null,
          detail: r.detail,
          ipAddress: r.ipAddress,
          createdAt: r.createdAt,
          platformUser: r.platformUser,
        })),
        total,
        page
      ),
      scope:
        user.role === "SUPER_ADMIN"
          ? "Tüm platform denetim izi"
          : user.role === "SUPPORT_AGENT"
            ? "Yalnızca kendi işlemleriniz"
            : "Kendi işlemleriniz + rol alanınıza giren kayıtlar",
      note:
        "Denetim izi append-only'dir (güncellenmez/silinmez) ve asgari 10 yıl saklanır. " +
        "CSV dışa aktarımı dört-göz onayına tabidir ve bu fazda uygulanmamıştır.",
    };
  }
}
