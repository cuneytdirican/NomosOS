import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import {
  changePasswordSchema,
  loginSchema,
  type ChangePasswordInput,
  type LoginInput,
} from "@nomosos/shared";
import { AuthService } from "./auth.service";
import { LoginThrottleGuard } from "./login-throttle.guard";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginThrottle: LoginThrottleGuard
  ) {}

  /**
   * Giriş ucu @Public'tir; bu nedenle IP + e-posta başına dakikada 5 denemeyle
   * sınırlandırılmıştır (bkz. LoginThrottleGuard). Başarılı girişte sayaç
   * sıfırlanır, böylece meşru kullanıcı cezalandırılmaz.
   */
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: Request
  ) {
    const result = await this.authService.login(body);
    this.loginThrottle.reset(request);
    return result;
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
   */
  @Post("auth/logout")
  @HttpCode(200)
  logout(@CurrentUser() user: AuthUser) {
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
