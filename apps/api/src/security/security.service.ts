/**
 * BÜRO GÜVENLİK & YÖNETİŞİM (Enterprise++).
 *
 *  1. GÜVENLİK POLİTİKASI (Tenant): `require2fa` (iki adımlı doğrulama zorunlu),
 *     `sessionMaxHours` (oturum ömrü 1-24 sa). Yalnız ADMIN değiştirir; her
 *     değişiklik denetim izine yazılır ve 2FA zorunluluğu açılınca 2FA'sız
 *     kullanıcılar bir sonraki girişte kuruluma zorlanır.
 *  2. DENETİM İZİ (AuditLog) — büronun KENDİ kayıtları: kim, ne zaman, neyi.
 *     Büro sahibi/ortak okur; süzgeç (işlem, kullanıcı, tarih, metin) +
 *     sayfalama + CSV dışa aktarımı. Dışa aktarım da denetim izine düşer.
 *     CSV hücreleri formül enjeksiyonuna karşı korunur (=, +, -, @ önekli
 *     hücre tek tırnakla nötrlenir).
 */

import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import { paged, resolvePage } from "../common/pagination";
import { parseDateParam, parseRangeEnd } from "../common/dates";
import type { AuthUser } from "../common/types";
import { SESSION_HOURS_MAX, SESSION_HOURS_MIN } from "../auth/session.service";

export interface SecurityPolicyInput {
  require2fa?: boolean;
  sessionMaxHours?: number | null;
  /** KVKK saklama yılı (kapanış + N; 10-30). */
  retentionYears?: number;
}

export interface AuditQuery {
  action?: string;
  userId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
  limit?: string;
}

/** CSV'ye yazılacak azami satır — büyük dışa aktarım tarih süzgeciyle bölünür. */
export const AUDIT_EXPORT_MAX_ROWS = 5000;

/** Hücreyi CSV için kaçırır ve formül enjeksiyonunu nötrler. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Formül enjeksiyonu: Excel/LibreOffice =, +, -, @ ile başlayan hücreyi formül sayar.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r;]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ //
  // Politika
  // ------------------------------------------------------------------ //

  async getPolicy(user: AuthUser) {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { require2fa: true, sessionMaxHours: true, retentionYears: true },
    });
    const [total, withTwoFactor] = await Promise.all([
      this.prisma.client.user.count({ where: { tenantId: user.tenantId, isActive: true } }),
      this.prisma.client.user.count({
        where: { tenantId: user.tenantId, isActive: true, twoFactorSecret: { not: null } },
      }),
    ]);
    return {
      require2fa: tenant?.require2fa ?? false,
      sessionMaxHours: tenant?.sessionMaxHours ?? null,
      retentionYears: tenant?.retentionYears ?? 10,
      /** Ekran için: aktif kullanıcıların kaçında 2FA kurulu. */
      users: { total, withTwoFactor },
      canEdit: user.role === "ADMIN",
    };
  }

  async updatePolicy(user: AuthUser, input: SecurityPolicyInput) {
    assertRole(user, ["ADMIN"], "büro güvenlik politikasını değiştirme");
    if (
      input.sessionMaxHours !== undefined &&
      input.sessionMaxHours !== null &&
      (!Number.isInteger(input.sessionMaxHours) ||
        input.sessionMaxHours < SESSION_HOURS_MIN ||
        input.sessionMaxHours > SESSION_HOURS_MAX)
    ) {
      throw new BadRequestException(`Oturum ömrü ${SESSION_HOURS_MIN}-${SESSION_HOURS_MAX} saat aralığında olmalıdır.`);
    }
    if (
      input.retentionYears !== undefined &&
      (!Number.isInteger(input.retentionYears) || input.retentionYears < 10 || input.retentionYears > 30)
    ) {
      throw new BadRequestException("Saklama süresi 10-30 yıl aralığında olmalıdır (Avukatlık K. m.39 asgari 10 yıl).");
    }
    const data: Prisma.TenantUpdateInput = {};
    if (input.require2fa !== undefined) data.require2fa = input.require2fa;
    if (input.sessionMaxHours !== undefined) data.sessionMaxHours = input.sessionMaxHours;
    if (input.retentionYears !== undefined) data.retentionYears = input.retentionYears;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Güncellenecek bir alan gönderin (require2fa, sessionMaxHours, retentionYears).");
    }
    const updated = await this.prisma.client.tenant.update({
      where: { id: user.tenantId },
      data,
      select: { require2fa: true, sessionMaxHours: true, retentionYears: true },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "SECURITY_POLICY_UPDATE",
      entity: "Tenant",
      entityId: user.tenantId,
      detail:
        `2FA zorunlu=${updated.require2fa ? "evet" : "hayır"}, ` +
        `oturum ömrü=${updated.sessionMaxHours ?? "varsayılan (12 sa)"}, saklama=${updated.retentionYears} yıl`,
    });
    return updated;
  }

  // ------------------------------------------------------------------ //
  // Denetim izi
  // ------------------------------------------------------------------ //

  private auditWhere(user: AuthUser, query: AuditQuery): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { tenantId: user.tenantId };
    if (query.action?.trim()) where.action = query.action.trim().toUpperCase();
    if (query.userId?.trim()) where.userId = query.userId.trim();
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: parseDateParam(query.from, "from") } : {}),
        ...(query.to ? { lte: parseRangeEnd(query.to, "to") } : {}),
      };
    }
    const q = query.q?.trim().slice(0, 200);
    if (q) {
      where.OR = [
        { detail: { contains: q, mode: "insensitive" } },
        { entity: { contains: q, mode: "insensitive" } },
        { entityId: { contains: q, mode: "insensitive" } },
      ];
    }
    return where;
  }

  async listAudit(user: AuthUser, query: AuditQuery) {
    assertRole(user, ROLE_SETS.ONAY, "büro denetim izini görüntüleme");
    const page = resolvePage(query, 50);
    const where = this.auditWhere(user, query);
    const [rows, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);
    const users = await this.userNames(user.tenantId, rows.map((r) => r.userId));
    return paged(
      rows.map((r) => ({ ...r, userName: r.userId ? (users.get(r.userId) ?? null) : null })),
      total,
      page,
    );
  }

  /** Süzgeç listesi için büroda geçen işlem adları. */
  async auditActions(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "büro denetim izini görüntüleme");
    const rows = await this.prisma.client.auditLog.groupBy({
      by: ["action"],
      where: { tenantId: user.tenantId },
      _count: { _all: true },
      orderBy: { action: "asc" },
    });
    return rows.map((r) => ({ action: r.action, count: r._count._all }));
  }

  async exportAuditCsv(user: AuthUser, query: AuditQuery): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
    assertRole(user, ROLE_SETS.ONAY, "büro denetim izini dışa aktarma");
    const where = this.auditWhere(user, query);
    const rows = await this.prisma.client.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: AUDIT_EXPORT_MAX_ROWS + 1,
    });
    const truncated = rows.length > AUDIT_EXPORT_MAX_ROWS;
    const slice = truncated ? rows.slice(0, AUDIT_EXPORT_MAX_ROWS) : rows;
    const users = await this.userNames(user.tenantId, slice.map((r) => r.userId));
    const header = ["tarih", "kullanici", "islem", "varlik", "varlikId", "ayrinti"].join(";");
    const lines = slice.map((r) =>
      [
        r.createdAt.toISOString(),
        r.userId ? (users.get(r.userId) ?? r.userId) : "sistem",
        r.action,
        r.entity ?? "",
        r.entityId ?? "",
        r.detail ?? "",
      ]
        .map(csvCell)
        .join(";"),
    );
    // Dışa aktarım da bir denetim olayıdır.
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AUDIT_EXPORT",
      entity: "AuditLog",
      detail: `${slice.length} satır CSV dışa aktarıldı${truncated ? ` (ilk ${AUDIT_EXPORT_MAX_ROWS}; süzgeçle daraltın)` : ""}.`,
    });
    // UTF-8 BOM: Excel Türkçe karakterleri doğru açsın.
    return { csv: `\uFEFF${[header, ...lines].join("\r\n")}`, rowCount: slice.length, truncated };
  }

  private async userNames(tenantId: string, ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.client.user.findMany({
      where: { tenantId, id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }
}
