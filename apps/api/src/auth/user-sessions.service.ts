/**
 * CİHAZ BAZLI OTURUM LİSTESİ (Enterprise++).
 *
 * Her giriş bir `UserSession` satırı üretir (JWT `jti`). `JwtAuthGuard` her
 * istekte satırın iptal edilmediğini doğrular (30 sn önbellek) ve
 * `lastSeenAt`'i seyrek tazeler. Böylece kullanıcı "hangi cihazlarda açığım"
 * sorusunu görür ve tek bir cihazı kapatabilir; bugüne kadar yalnız "tümünü
 * düşür" (sessionsValidFrom) vardı — o mekanizma korunur, bu onun üstüne gelir.
 *
 * "Açık" tanımı: iptal edilmemiş + süresi dolmamış + kullanıcının
 * `sessionsValidFrom` damgasından SONRA açılmış (damga tüm eski oturumları
 * geçersiz kılar; satırları tek tek işaretlemeye gerek yoktur).
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { parseUserAgent } from "./user-agent";

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export interface SessionRow {
  id: string;
  deviceLabel: string;
  ip: string | null;
  via: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  current: boolean;
}

const LIST_SELECT = { id: true, jti: true, deviceLabel: true, ip: true, via: true, createdAt: true, lastSeenAt: true, expiresAt: true } as const;

@Injectable()
export class UserSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Girişte çağrılır (SessionService.issue). */
  async record(input: { id: string; tenantId: string; userId: string; jti: string; via: string; expiresAt: Date; meta?: SessionMeta }) {
    const parsed = parseUserAgent(input.meta?.userAgent);
    await this.prisma.client.userSession.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        userId: input.userId,
        jti: input.jti,
        via: input.via,
        userAgent: input.meta?.userAgent?.slice(0, 500) ?? null,
        deviceLabel: parsed.label,
        ip: input.meta?.ip?.slice(0, 64) ?? null,
        expiresAt: input.expiresAt,
      },
    });
  }

  /** Kullanıcının kendi açık oturumları (şu anki işaretli). */
  async listOwn(user: AuthUser): Promise<{ items: SessionRow[] }> {
    return { items: await this.activeFor(user.userId, user.sessionId) };
  }

  /** Kendi oturumunu (bu cihaz dâhil) kapatır. */
  async revokeOwn(user: AuthUser, id: string) {
    const row = await this.prisma.client.userSession.findFirst({ where: { id, userId: user.userId, revokedAt: null }, select: { id: true, deviceLabel: true } });
    if (!row) throw new NotFoundException("Oturum bulunamadı ya da zaten kapalı.");
    await this.prisma.client.userSession.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedBy: user.userId } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "SESSION_REVOKE",
      entity: "UserSession",
      entityId: row.id,
      detail: `${row.deviceLabel}${row.id === user.sessionId ? " (bu cihaz)" : ""}`,
    });
    return { ok: true as const, current: row.id === user.sessionId };
  }

  /** Bu cihaz DIŞINDAKİ tüm oturumları kapatır. */
  async revokeOthers(user: AuthUser) {
    const now = new Date();
    const res = await this.prisma.client.userSession.updateMany({
      where: { userId: user.userId, revokedAt: null, expiresAt: { gt: now }, ...(user.sessionId ? { id: { not: user.sessionId } } : {}) },
      data: { revokedAt: now, revokedBy: user.userId },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "SESSION_REVOKE",
      entity: "User",
      entityId: user.userId,
      detail: `Diğer cihazlardaki ${res.count} oturum kapatıldı.`,
    });
    return { ok: true as const, revoked: res.count };
  }

  /** Yönetici: büro kullanıcısının açık oturumları. */
  async listForUser(admin: AuthUser, userId: string) {
    assertRole(admin, ROLE_SETS.ONAY, "kullanıcı oturumlarını görüntüleme");
    await this.requireTenantUser(admin.tenantId, userId);
    return { items: await this.activeFor(userId, admin.userId === userId ? admin.sessionId : undefined) };
  }

  /** Yönetici: tek oturumu kapatır. */
  async revokeForUser(admin: AuthUser, userId: string, id: string) {
    assertRole(admin, ROLE_SETS.ONAY, "kullanıcı oturumunu kapatma");
    const target = await this.requireTenantUser(admin.tenantId, userId);
    const row = await this.prisma.client.userSession.findFirst({ where: { id, userId, revokedAt: null }, select: { id: true, deviceLabel: true } });
    if (!row) throw new NotFoundException("Oturum bulunamadı ya da zaten kapalı.");
    await this.prisma.client.userSession.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedBy: admin.userId } });
    await this.audit.log({
      tenantId: admin.tenantId,
      userId: admin.userId,
      action: "SESSION_REVOKE",
      entity: "UserSession",
      entityId: row.id,
      detail: `${target.email} — ${row.deviceLabel} (yönetici)`,
    });
    return { ok: true as const };
  }

  /** Süresi 30 günden uzun süre önce dolmuş/iptal edilmiş satırları siler (zamanlanmış iş). */
  async purgeStale(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 24 * 3_600_000);
    const res = await this.prisma.client.userSession.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
    return res.count;
  }

  // ------------------------------------------------------------------ //

  private async activeFor(userId: string, currentSessionId: string | undefined): Promise<SessionRow[]> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { sessionsValidFrom: true } });
    const now = new Date();
    const rows = await this.prisma.client.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        ...(user?.sessionsValidFrom ? { createdAt: { gte: user.sessionsValidFrom } } : {}),
      },
      orderBy: { lastSeenAt: "desc" },
      take: 50,
      select: LIST_SELECT,
    });
    return rows.map(({ jti: _jti, ...r }) => ({ ...r, current: r.id === currentSessionId }));
  }

  private async requireTenantUser(tenantId: string, userId: string) {
    const u = await this.prisma.client.user.findFirst({ where: { id: userId, tenantId }, select: { id: true, email: true } });
    if (!u) throw new NotFoundException("Kullanıcı bulunamadı.");
    return u;
  }
}
