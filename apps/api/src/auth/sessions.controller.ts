/**
 * Kendi oturumları (Enterprise++ cihaz bazlı oturum listesi).
 *
 *   GET    /auth/sessions        — açık oturumlarım (bu cihaz işaretli)
 *   DELETE /auth/sessions/:id    — tek oturumu kapat (bu cihaz olabilir)
 *   DELETE /auth/sessions        — bu cihaz DIŞINDAKİ tüm oturumları kapat
 */

import { Controller, Delete, Get, HttpCode, Param } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { UserSessionsService } from "./user-sessions.service";

@Controller("auth/sessions")
export class SessionsController {
  constructor(private readonly sessions: UserSessionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.sessions.listOwn(user);
  }

  @Delete()
  @HttpCode(200)
  revokeOthers(@CurrentUser() user: AuthUser) {
    return this.sessions.revokeOthers(user);
  }

  @Delete(":id")
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.sessions.revokeOwn(user, id);
  }
}
