import { Body, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { LoginThrottleGuard } from "../../auth/login-throttle.guard";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import {
  AnyPlatformRole,
  PlatformAnonymous,
  WritePermission,
} from "../decorators/platform-permission.decorator";
import { clientIp } from "../guards/platform-jwt.guard";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformAuthService } from "./platform-auth.service";
import {
  changePasswordSchema,
  platformLoginSchema,
  twoFactorSetupSchema,
  twoFactorVerifySchema,
  type ChangePasswordInput,
  type PlatformLoginInput,
  type TwoFactorSetupInput,
  type TwoFactorVerifyInput,
} from "./platform-auth.schemas";

/**
 * `/api/admin/v1/auth/*`
 *
 * Giriş uçları IP + e-posta başına dakikada 5 denemeyle sınırlıdır
 * (spec §Güvenlik 3). `bcrypt.compare` kasten pahalıdır; sınırsız deneme hem
 * kaba kuvvet hem de ucuz bir DoS yüzeyi olurdu.
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/auth`)
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly throttle: LoginThrottleGuard
  ) {}

  @PlatformAnonymous()
  @UseGuards(LoginThrottleGuard)
  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(platformLoginSchema)) body: PlatformLoginInput,
    @Req() request: Request
  ) {
    const result = await this.auth.login(body, clientIp(request));
    // Parola doğrulandığı anda sayaç sıfırlanır; ikinci adımı bekleyen meşru
    // kullanıcı, 2FA kodunu ararken kilitlenmez.
    await this.throttle.reset(request);
    return result;
  }

  /**
   * TOTP kurulumu. Giriş adımından dönen `challengeToken` ile ya da mevcut
   * panel oturumuyla çağrılabilir.
   */
  @PlatformAnonymous()
  @UseGuards(LoginThrottleGuard)
  @Post("2fa/setup")
  @HttpCode(200)
  setup(
    @Body(new ZodValidationPipe(twoFactorSetupSchema)) body: TwoFactorSetupInput,
    @Req() request: Request
  ) {
    const header = request.headers.authorization;
    return this.auth.setup({
      challengeToken: body.challengeToken,
      bearerToken: header?.startsWith("Bearer ") ? header.slice(7) : undefined,
      currentPassword: body.currentPassword,
      ip: clientIp(request),
    });
  }

  /** İkinci adım: TOTP doğrulama → panel JWT'si. */
  @PlatformAnonymous()
  @UseGuards(LoginThrottleGuard)
  @Post("2fa/verify")
  @HttpCode(200)
  async verify(
    @Body(new ZodValidationPipe(twoFactorVerifySchema)) body: TwoFactorVerifyInput,
    @Req() request: Request
  ) {
    const result = await this.auth.verify(body, clientIp(request));
    await this.throttle.reset(request);
    return result;
  }

  @Get("me")
  @AnyPlatformRole()
  me(@CurrentPlatformUser() user: PlatformAuthUser) {
    return this.auth.me(user);
  }

  /**
   * KENDİ PAROLASINI DEĞİŞTİRME — her panel rolüne açıktır.
   *
   * Yetki matrisine bağlı DEĞİLDİR: bu bir yönetim işlemi değil, kişinin kendi
   * kimlik bilgisidir. ANALYST_READONLY dâhil herkes kendi parolasını
   * değiştirebilmelidir (aksi hâlde sızmış bir parolayı kapatmanın yolu kalmaz).
   * Kapı, matris değil MEVCUT PAROLA + TOTP'dir.
   */
  @Post("change-password")
  @AnyPlatformRole()
  @HttpCode(200)
  changePassword(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() request: Request
  ) {
    return this.auth.changePassword(user, body, clientIp(request));
  }

  /** Kilitlenmiş hesabın kilidini açar — yalnız BAŞKA bir SUPER_ADMIN. */
  @Post("unlock/:id")
  @WritePermission("platform_user.manage")
  @HttpCode(200)
  unlock(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.auth.unlockUser(user, id);
  }
}
