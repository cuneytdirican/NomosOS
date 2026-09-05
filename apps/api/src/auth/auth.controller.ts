import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  changePasswordSchema,
  loginSchema,
  type ChangePasswordInput,
  type LoginInput,
} from "@nomosos/shared";
import { AuthService } from "./auth.service";
import { sessionMetaFrom } from "./session.service";
import { TwoFactorService } from "./two-factor.service";
import {
  twoFactorDisableSchema,
  twoFactorSetupSchema,
  twoFactorSetupWithChallengeSchema,
  twoFactorVerifySchema,
  type TwoFactorDisableInput,
  type TwoFactorSetupInput,
  type TwoFactorSetupWithChallengeInput,
  type TwoFactorVerifyInput,
} from "./two-factor.schemas";
import { LoginThrottleGuard } from "./login-throttle.guard";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AUTH_COOKIE_NAME, authCookieOptions } from "../common/auth-cookie";
import type { AuthUser } from "../common/types";

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly loginThrottle: LoginThrottleGuard
  ) {}

  /**
   * Giriş ucu @Public'tur; bu nedenle IP + e-posta başına dakikada 5 denemeyle
   * sınırlandırılmıştır (bkz. LoginThrottleGuard). Başarılı girişte sayaç
   * sıfırlanır, böylece meşru kullanıcı cezalandırılmaz.
   *
   * İ-46: JWT ayrıca httpOnly çerez olarak yazılır — tarayıcı oturumu XSS'e
   * karşı kapalıdır. Mobil istemci gövdedeki `accessToken`'ı kullanmaya devam
   * eder (çerez yalnız tarayıcı içindir).
   */
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.authService.login(body, sessionMetaFrom(request));
    await this.loginThrottle.reset(request);
    // 2FA challenge yanıtında oturum yoktur — çerez yazılmaz.
    if ("accessToken" in result) {
      response.cookie(AUTH_COOKIE_NAME, result.accessToken, {
        ...authCookieOptions(),
        maxAge: result.cookieMaxAgeMs,
      });
      return { accessToken: result.accessToken, user: result.user };
    }
    return result;
  }

  /* ---------------- İki adımlı doğrulama (Enterprise++) ---------------- */

  /**
   * İkinci adım: TOTP → oturum. Hem giriş challenge'ı hem kurulum token'ı
   * için tek uç. @Public: kullanıcının henüz oturumu yoktur; challenge imzalı
   * ve 10 dk ömürlüdür, deneme sayacı vardır.
   */
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post("auth/2fa/verify")
  @HttpCode(200)
  async verifyTwoFactor(
    @Body(new ZodValidationPipe(twoFactorVerifySchema)) body: TwoFactorVerifyInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.twoFactor.verify(body, sessionMetaFrom(request));
    await this.loginThrottle.reset(request);
    response.cookie(AUTH_COOKIE_NAME, result.accessToken, {
      ...authCookieOptions(),
      maxAge: result.cookieMaxAgeMs,
    });
    return { accessToken: result.accessToken, user: result.user };
  }

  /** Açık oturumla kurulum — mevcut parola zorunlu. */
  @Post("auth/2fa/setup")
  @HttpCode(200)
  setupTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(twoFactorSetupSchema)) body: TwoFactorSetupInput
  ) {
    return this.twoFactor.setupWithSession(user, body.currentPassword);
  }

  /** Girişte zorunlu kurulum (büro politikası) — challenge ile. */
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post("auth/2fa/setup-with-challenge")
  @HttpCode(200)
  setupTwoFactorWithChallenge(
    @Body(new ZodValidationPipe(twoFactorSetupWithChallengeSchema)) body: TwoFactorSetupWithChallengeInput
  ) {
    return this.twoFactor.setupWithChallenge(body.challengeToken);
  }

  /** Kapatma — parola + güncel kod; büro politikası zorunluysa 403. */
  @Post("auth/2fa/disable")
  @HttpCode(200)
  disableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(twoFactorDisableSchema)) body: TwoFactorDisableInput
  ) {
    return this.twoFactor.disable(user, body);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user);
  }

  /**
   * SUNUCU TARAFI ÇIKIŞ (denetim bulgusu Ö-34).
   *
   * Portalda vardı, büro ve platformda yoktu; büro token'ının ömrü 12 saattir
   * ve `clearToken()` onu geçersiz kılmıyordu.
   *
   * İ-46: httpOnly oturum çerezi de burada DÜŞÜRÜLÜR — tarayıcıdaki oturum
   * kapanır; `sessionsValidFrom` damgası kalan/çalınan belirteçleri de öldürür.
   */
  @Post("auth/logout")
  @HttpCode(200)
  logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response
  ) {
    response.clearCookie(AUTH_COOKIE_NAME, { path: "/api/v1" });
    return this.authService.logout(user);
  }

  /**
   * KENDİ PAROLASINI DEĞİŞTİRME (denetim bulgusu K-03).
   *
   * Bu uç var olmadığı için sızmış bir avukat parolası ürün üzerinden
   * kapatılamıyordu; tek çözüm `psql` ile elle karma yazmaktı.
   */
  @Post("auth/change-password")
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput
  ) {
    return this.authService.changePassword(user, body);
  }
}
