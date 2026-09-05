import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { CONTRACT_DOCS } from "@nomosos/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { TermsService, acceptTermsSchema, type AcceptTermsInput } from "./terms.service";

/** FAZ 8B — /terms: sözleşme metinleri + kabul durumu + kabul (ONAY rolü). */
@Controller("terms")
export class TermsController {
  constructor(private readonly terms: TermsService) {}

  /** Metinler (kiracıya özel değil) — uygulama içi okuma. */
  @Get("docs")
  docs() {
    return { items: CONTRACT_DOCS };
  }

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.terms.status(user.tenantId);
  }

  @Post("accept")
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(acceptTermsSchema)) body: AcceptTermsInput, @Req() req: Request) {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || null;
    return this.terms.accept(user, body, { ip, userAgent: (req.headers["user-agent"] as string | undefined) ?? null });
  }
}
