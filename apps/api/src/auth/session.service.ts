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
  async issue(user: SessionUser, via: "parola" | "parola+2fa"): Promise<IssuedSession> {
    const hours = await this.sessionHoursFor(user.tenantId);
    const payload: JwtPayload = { sub: user.id, tenantId: user.tenantId, role: user.role };
    // GÜVENLİK: audience damgası (`aud: "tenant"`) — bkz. common/jwt-audience.ts.
    const accessToken = await this.jwt.signAsync(payload, {
      audience: TENANT_JWT_AUDIENCE,
      expiresIn: `${hours}h`,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: "LOGIN_SUCCESS",
      entity: "User",
      entityId: user.id,
      detail: `${user.email} (${via}, oturum ${hours} sa)`,
    });
    return {
      accessToken,
      cookieMaxAgeMs: Math.min(AUTH_COOKIE_MAX_AGE_MS, hours * 60 * 60 * 1000),
      user,
    };
  }
}
