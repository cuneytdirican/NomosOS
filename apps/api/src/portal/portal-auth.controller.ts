import { Body, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentPortalUser } from "./decorators/current-portal-user.decorator";
import { PortalAnonymous } from "./decorators/portal-anonymous.decorator";
import { PortalAudit } from "./decorators/portal-audit.decorator";
import { PortalController } from "./decorators/portal-controller.decorator";
import { PortalRateLimit, PortalRateLimitGuard } from "./guards/portal-rate-limit.guard";
import { portalClientIp } from "./guards/portal-jwt.guard";
import { PortalAuthService } from "./portal-auth.service";
import {
  portalAcceptInviteSchema,
  portalForgotPasswordSchema,
  portalInviteCheckSchema,
  portalLoginSchema,
  portalResetPasswordSchema,
  type PortalAcceptInviteInput,
  type PortalForgotPasswordInput,
  type PortalInviteCheckInput,
  type PortalLoginInput,
  type PortalResetPasswordInput,
} from "./portal.schemas";
import type { PortalAuthUser } from "./portal.types";

/**
 * PORTAL KİMLİK UÇLARI — `/api/v1/portal/auth/**`
 *
 * Dördü de `@PortalAnonymous()`: token'sız erişilir. Bu YEGÂNE muafiyettir;
 * portalın diğer tüm uçları kimlik ister. Kimliksiz oldukları için her biri
 * ayrı bir hız sınırı kovasına bağlanmıştır.
 */
@PortalController("portal/auth")
export class PortalAuthController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly rateLimit: PortalRateLimitGuard
  ) {}

  /**
   * Giriş. İKİ KATMANLI KORUMA:
   *   - IP + e-posta başına dakikada 5 istek (bu guard),
   *   - e-posta başına 5 hatalı denemede 15 dakika kilit (PortalAuthService).
   * Başarılı girişte IP sayacı sıfırlanır; meşru kullanıcı cezalandırılmaz.
   */
  @PortalAnonymous()
  @PortalRateLimit({ limit: 5, windowMs: 60_000, bucket: "portal-login" })
  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(portalLoginSchema)) body: PortalLoginInput,
    @Req() request: Request
  ) {
    const result = await this.auth.login(body, portalClientIp(request));
    await this.rateLimit.reset(request, "portal-login");
    return result;
  }

  /**
   * Davet ön kontrolü — "bu bağlantı hâlâ geçerli mi, kime açılmış?".
   *
   * GET DEĞİL, POST'tur ve token GÖVDEDE taşınır. Bir `GET /auth/invite/:token`
   * ucu, ham token'ı sunucu erişim günlüklerine ve ters vekil/CDN kayıtlarına
   * yazardı; o günlüğü okuyabilen biri daveti kendi belirlediği parolayla
   * kullanabilirdi (denetim bulgusu 8).
   */
  @PortalAnonymous()
  @PortalRateLimit({ limit: 10, windowMs: 60_000, bucket: "portal-invite" })
  @Post("invite/check")
  @HttpCode(200)
  checkInvite(
    @Body(new ZodValidationPipe(portalInviteCheckSchema)) body: PortalInviteCheckInput
  ) {
    return this.auth.checkInvite(body);
  }

  /** Davet bağlantısıyla hesap açma (ham token yalnızca müvekkilin elindedir). */
  @PortalAnonymous()
  @PortalRateLimit({ limit: 10, windowMs: 60_000, bucket: "portal-invite" })
  @Post("accept-invite")
  @HttpCode(200)
  acceptInvite(
    @Body(new ZodValidationPipe(portalAcceptInviteSchema)) body: PortalAcceptInviteInput,
    @Req() request: Request
  ) {
    return this.auth.acceptInvite(body, portalClientIp(request));
  }

  /**
   * ÇIKIŞ — sunucu tarafında. Hesabın `sessionsValidFrom` damgası tazelenir ve
   * bu andan önce üretilmiş TÜM portal token'ları geçersizleşir.
   */
  @PortalAudit("PORTAL_LOGOUT", "PortalUser")
  @Post("logout")
  @HttpCode(200)
  logout(@CurrentPortalUser() user: PortalAuthUser) {
    return this.auth.logout(user);
  }

  /** Parola sıfırlama talebi — hesap olsun olmasın AYNI yanıt döner. */
  @PortalAnonymous()
  @PortalRateLimit({ limit: 5, windowMs: 15 * 60_000, bucket: "portal-forgot" })
  @Post("forgot-password")
  @HttpCode(200)
  forgotPassword(
    @Body(new ZodValidationPipe(portalForgotPasswordSchema)) body: PortalForgotPasswordInput,
    @Req() request: Request
  ) {
    return this.auth.forgotPassword(body, portalClientIp(request));
  }

  @PortalAnonymous()
  @PortalRateLimit({ limit: 10, windowMs: 60_000, bucket: "portal-reset" })
  @Post("reset-password")
  @HttpCode(200)
  resetPassword(
    @Body(new ZodValidationPipe(portalResetPasswordSchema)) body: PortalResetPasswordInput,
    @Req() request: Request
  ) {
    return this.auth.resetPassword(body, portalClientIp(request));
  }

  /** Oturum sahibinin kimlik kartı (büro adı, müvekkil adı). */
  @PortalAudit("PORTAL_ME", "PortalUser")
  @Get("me")
  me(@CurrentPortalUser() user: PortalAuthUser) {
    return this.auth.me(user);
  }
}
