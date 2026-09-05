/**
 * SSO uçları (Enterprise++ OIDC kurumsal giriş).
 *
 *   POST /auth/sso/start { email }      — @Public; yetkilendirme adresi döner
 *   GET  /auth/sso/callback?code&state  — @Public; IdP geri dönüşü → çerez + yönlendirme
 *   GET  /security/sso                  — yapılandırma (ADMIN/PARTNER)
 *   PUT  /security/sso                  — yapılandırma (yalnız ADMIN)
 *   POST /security/sso/test             — discovery testi
 */

import { Body, Controller, Get, HttpCode, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { Public } from "../common/decorators/public.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AUTH_COOKIE_NAME, authCookieOptions } from "../common/auth-cookie";
import { webOrigin } from "../common/public-urls";
import type { AuthUser } from "../common/types";
import { LoginThrottleGuard } from "./login-throttle.guard";
import { SsoService } from "./sso.service";
import { sessionMetaFrom } from "./session.service";

const startSchema = z.object({ email: z.string().trim().email("Geçerli bir e-posta adresi girin.").max(200) });
const configSchema = z.object({
  enabled: z.boolean().optional(),
  issuer: z.string().trim().max(500).nullable().optional(),
  clientId: z.string().trim().max(300).nullable().optional(),
  clientSecret: z.string().max(1000).nullable().optional(),
  emailDomain: z.string().trim().max(200).nullable().optional(),
  enforced: z.boolean().optional(),
  autoProvision: z.boolean().optional(),
  defaultRole: z.enum(["PARTNER", "AVUKAT", "STAJYER", "SEKRETER"]).optional(),
});

@Controller()
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly loginThrottle: LoginThrottleGuard,
  ) {}

  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post("auth/sso/start")
  @HttpCode(200)
  start(@Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>) {
    return this.sso.start(body.email);
  }

  /**
   * IdP geri dönüşü tarayıcı GEZİNMESİDİR (JSON istemcisi değil): başarıda
   * httpOnly çerez yazılır ve /app'e, hatada /giris?sso_error=… adresine
   * yönlendirilir. Hata metni kullanıcıya gösterilir; iç ayrıntı sızmaz.
   */
  @Public()
  @Get("auth/sso/callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const back = (msg: string) => response.redirect(`${webOrigin()}/giris?sso_error=${encodeURIComponent(msg)}`);
    if (error) return back(errorDescription ? `Kimlik sağlayıcı reddetti: ${errorDescription}` : `Kimlik sağlayıcı reddetti (${error}).`);
    if (!code || !state) return back("SSO geri dönüşü eksik (code/state).");
    try {
      const result = await this.sso.callback(code, state, sessionMetaFrom(request));
      await this.loginThrottle.reset(request);
      response.cookie(AUTH_COOKIE_NAME, result.accessToken, { ...authCookieOptions(), maxAge: result.cookieMaxAgeMs });
      return response.redirect(`${webOrigin()}/app`);
    } catch (err) {
      const msg = (err as { message?: string })?.message || "Kurumsal giriş tamamlanamadı.";
      return back(msg);
    }
  }

  @Get("security/sso")
  config(@CurrentUser() user: AuthUser) {
    return this.sso.getConfig(user);
  }

  @RequiresModule("sso")
  @Put("security/sso")
  updateConfig(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(configSchema)) body: z.infer<typeof configSchema>) {
    return this.sso.updateConfig(user, body);
  }

  @RequiresModule("sso")
  @Post("security/sso/test")
  @HttpCode(200)
  test(@CurrentUser() user: AuthUser) {
    return this.sso.testConnection(user);
  }
}
