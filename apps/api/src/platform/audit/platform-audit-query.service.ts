import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { normalizeQuery, paged, resolvePage } from "../../common/pagination";
import { buildDateRange } from "../tenants/platform-tenants.service";
import { PlatformAuditService } from "../platform-audit.service";
import { PlatformApprovalsService } from "../approvals/platform-approvals.service";
import { APPROVAL_ACTIONS } from "../approvals/approval-actions";
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly approvals: PlatformApprovalsService
  ) {}

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

    // platformUserId FK DEĞİLDİR (denetim bulgusu Ö-27 kalıntısı): ad-soyad
    // çözümlemesi tenantIds gibi AYRI sorguyla yapılır. Kullanıcı silinmişse
    // iz "(silinmiş kullanıcı)" şeridiyle AYAKTA KALIR — join olsaydı satır
    // kaybolur ya da include null düşerdi.
    const userIds = [...new Set(rows.map((r) => r.platformUserId).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.client.platformUser.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true, email: true, role: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const resolveUser = (id: string | null) =>
      id
        ? userById.get(id) ?? {
            id,
            fullName: "(silinmiş kullanıcı)",
            email: null as string | null,
            role: null as string | null,
          }
        : null;

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
          platformUser: resolveUser(r.platformUserId),
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
        "CSV dışa aktarımı DÖRT-GÖZ onayına tabidir: POST /audit/export ile talep açılır, " +
        "onaydan sonra GET /audit/export/:approvalId ile TEK SEFER indirilir.",
    };
  }

  /**
   * DIŞA AKTARIM TALEBİ — spec §Roller dört-göz listesi MADDE 8 (bulgu Ö-28).
   *
   * Katalogda bu madde yoktu çünkü uç de yoktu; denetim izinin tamamını panel
   * dışına taşıyan işlem tek imzayla yapılabilir durumdaydı (daha doğrusu hiç
   * yapılamıyordu ve söz verilen yetenek eksikti).
   */
  async requestExport(
    user: PlatformAuthUser,
    input: { from?: string; to?: string; tenantId?: string; action?: string; reason: string }
  ) {
    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.AUDIT_EXPORT,
      tenantId: input.tenantId ?? null,
      payload: {
        from: input.from,
        to: input.to,
        tenantId: input.tenantId,
        action: input.action,
        reason: input.reason,
      },
      summary:
        `Platform denetim izi dışa aktarımı (${input.from ?? "başlangıç"} → ${input.to ?? "bugün"}` +
        `${input.tenantId ? `, büro ${input.tenantId}` : ""}). Gerekçe: ${input.reason}`,
    });
  }

  /**
   * ONAYLANMIŞ DIŞA AKTARIMI TEK SEFER İNDİRİR.
   *
   * ÜÇ KAPI:
   *   1. talep ONAYLANDI durumunda olmalı (dört-göz tamamlanmış),
   *   2. indiren, talebi AÇAN kişi olmalı — onaylayan indiremez; "talep eden ≠
   *      onaylayan" kuralı indirme tarafında da anlamını korusun,
   *   3. TEK SEFERLİK: indirme `AUDIT_EXPORT_DOWNLOAD` olarak denetim izine
   *      yazılır ve aynı talep için ikinci kayıt varsa istek reddedilir.
   *      Sayacı ayrı bir tabloda tutmak yerine denetim izinin kendisini
   *      kullanmak, "indirildi mi" sorusunun tek doğru kaynağını korur.
   */
  async downloadExport(user: PlatformAuthUser, approvalId: string) {
    const request = await this.prisma.client.platformApprovalRequest.findUnique({
      where: { id: approvalId },
    });
    if (!request || request.action !== APPROVAL_ACTIONS.AUDIT_EXPORT) {
      throw new NotFoundException("Dışa aktarım talebi bulunamadı.");
    }
    if (request.status !== "ONAYLANDI") {
      throw new ForbiddenException(
        "Bu dışa aktarım henüz dört-göz onayı almadı; indirme yapılamaz."
      );
    }
    if (request.requestedBy !== user.id) {
      throw new ForbiddenException(
        "Dışa aktarımı yalnızca talebi AÇAN kişi indirebilir."
      );
    }

    const already = await this.prisma.client.platformAuditLog.count({
      where: { action: "AUDIT_EXPORT_DOWNLOAD", entityId: approvalId },
    });
    if (already > 0) {
      throw new ForbiddenException(
        "Bu dışa aktarım daha önce indirildi. Dışa aktarım TEK SEFERLİKTİR; " +
          "yeni bir talep açın."
      );
    }

    const payload = JSON.parse(request.payloadJson) as {
      from?: string;
      to?: string;
      tenantId?: string;
      action?: string;
    };

    const where: Prisma.PlatformAuditLogWhereInput = {};
    if (payload.tenantId) where.tenantId = payload.tenantId;
    if (payload.action) where.action = { contains: payload.action.toUpperCase() };
    const range = buildDateRange({ from: payload.from, to: payload.to });
    if (range) where.createdAt = range;

    const rows = await this.prisma.client.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: AUDIT_EXPORT_MAX_ROWS,
    });

    await this.audit.log({
      actor: user,
      action: "AUDIT_EXPORT_DOWNLOAD",
      entity: "PlatformApprovalRequest",
      entityId: approvalId,
      tenantId: payload.tenantId ?? null,
      detail: `${rows.length} denetim kaydı dışa aktarıldı (tek seferlik indirme).`,
    });

    return {
      approvalId,
      rowCount: rows.length,
      truncated: rows.length === AUDIT_EXPORT_MAX_ROWS,
      csv: toCsv(rows),
      note:
        "Bu dışa aktarım TEK SEFERLİKTİR; indirme denetim izine yazıldı. " +
        (rows.length === AUDIT_EXPORT_MAX_ROWS
          ? `Sonuç ${AUDIT_EXPORT_MAX_ROWS} satırda kesildi; tarih aralığını daraltın.`
          : ""),
    };
  }
}

/** Tek dışa aktarımda taşınabilecek azami satır (bellek koruması). */
const AUDIT_EXPORT_MAX_ROWS = 50_000;

/** RFC 4180 kaçışı: tırnak ikilenir, alan tırnak içine alınır. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: readonly Record<string, unknown>[]): string {
  const header = [
    "id",
    "createdAt",
    "platformUserId",
    "action",
    "entity",
    "entityId",
    "tenantId",
    "detail",
    "ipAddress",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => csvCell(row[key])).join(","));
  }
  return lines.join("\n");
}
