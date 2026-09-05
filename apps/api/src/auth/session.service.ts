/**
 * KİRACI OTURUM ÜRETİCİSİ — tek kapı.
 *
 * `AuthService.login` (parola) ve `TwoFactorService.verify` (TOTP) aynı
 * oturumu üretir; ikisi de buradan geçer ki oturum süresi politikası
 * (Tenant.sessionMaxHours — Enterprise++ büro güvenlik politikası) ve
 * audience damgası tek yerde uygulansın.
 */

import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { UserSessionsService, type SessionMeta } from "./user-sessions.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { JwtPayload } from "../common/types";
import { TENANT_JWT_AUDIENCE } from "../common/jwt-audience";
import { AUTH_COOKIE_MAX_AGE_MS } from "../common/auth-cookie";
import type { UserRole } from "@nomosos/shared";

/** Varsayılan oturum ömrü (saat) — büro politikası yoksa. */
export const DEFAULT_SESSION_HOURS = 12;
/** Büro politikasında seçilebilir aralık. */
export const SESSION_HOURS_MIN = 1;
export const SESSION_HOURS_MAX = 24;

export interface SessionUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export interface IssuedSession {
  accessToken: string;
  /** Çerez ömrü (ms) — büro politikasına göre; denetleyici çereze yazar. */
  cookieMaxAgeMs: number;
  user: SessionUser;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly sessions: UserSessionsService,
  ) {}

  /** Büronun oturum ömrü politikası (saat). */
  async sessionHoursFor(tenantId: string): Promise<number> {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { sessionMaxHours: true },
    });
    const hours = tenant?.sessionMaxHours ?? DEFAULT_SESSION_HOURS;
    return Math.min(SESSION_HOURS_MAX, Math.max(SESSION_HOURS_MIN, hours));
  }

  /**
   * Oturum üretir + LOGIN_SUCCESS denetim kaydı yazar.
   * `via` denetim izinde giriş yolunu (parola / parola+TOTP) belgeler.
   */
  async issue(user: SessionUser, via: "parola" | "parola+2fa" | "sso", meta?: SessionMeta): Promise<IssuedSession> {
    const hours = await this.sessionHoursFor(user.tenantId);
    // Enterprise++: cihaz bazlı oturum — token `jti` taşır, UserSession satırı
    // yazılır; guard her istekte iptali denetler (tek cihazı kapatma).
    const jti = randomBytes(16).toString("hex");
    const sessionId = randomUUID();
    const payload: JwtPayload = { sub: user.id, tenantId: user.tenantId, role: user.role, jti };
    // GÜVENLİK: audience damgası (`aud: "tenant"`) — bkz. common/jwt-audience.ts.
    const accessToken = await this.jwt.signAsync(payload, {
      audience: TENANT_JWT_AUDIENCE,
      expiresIn: `${hours}h`,
    });
    await this.sessions.record({
      id: sessionId,
      tenantId: user.tenantId,
      userId: user.id,
      jti,
      via,
      expiresAt: new Date(Date.now() + hours * 3_600_000),
      meta,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: "LOGIN_SUCCESS",
      entity: "User",
      entityId: user.id,
      detail: `${user.email} (${via}, oturum ${hours} sa, ${meta?.userAgent ? "cihaz kaydedildi" : "cihaz bilinmiyor"})`,
    });
    return {
      accessToken,
      cookieMaxAgeMs: Math.min(AUTH_COOKIE_MAX_AGE_MS, hours * 60 * 60 * 1000),
      user,
    };
  }
}

/** İstekten cihaz bilgisi (User-Agent + IP) — denetleyiciler oturum üretimine geçirir. */
export function sessionMetaFrom(request: Request): SessionMeta {
  const ua = request.headers["user-agent"];
  return { userAgent: typeof ua === "string" ? ua : null, ip: request.ip ?? null };
}
