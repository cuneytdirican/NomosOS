import { Body, Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { UsersService } from "./users.service";
import {
  createUserSchema,
  resetUserPasswordSchema,
  updateUserSchema,
  type CreateUserInput,
  type ResetUserPasswordInput,
  type UpdateUserInput,
} from "./users.dto";

/**
 * BÜRO KULLANICI UÇLARI — `/api/v1/users`
 *
 * `GET /users` NEDEN VAR: onay kuyruğunda GOREV önerisi, dosyanın sorumlu
 * avukatı atanmamışsa `assigneeId` ZORUNLUDUR (proposals.service.ts). Arayüzde
 * sorumlu seçici olmadığı için o öneriler daima 400 alıyordu.
 *
 * YAZMA UÇLARI (denetim bulgusu K-03): hiç yoktu. API bir kiracı kullanıcısı
 * açamıyor, pasifleştiremiyor, rolünü değiştiremiyor, parolasını
 * sıfırlayamıyordu; sızmış bir parolayı kapatmanın tek yolu doğrudan SQL'di.
 */
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.listForAssignment(user);
  }

  /** Yönetim listesi — e-posta ve kilit durumu dâhil, yalnız ADMIN/PARTNER. */
  @Get("manage")
  listForManagement(@CurrentUser() user: AuthUser) {
    return this.users.listForManagement(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput
  ) {
    return this.users.create(user, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput
  ) {
    return this.users.update(user, id, body);
  }

  @Post(":id/reset-password")
  @HttpCode(200)
  resetPassword(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resetUserPasswordSchema)) body: ResetUserPasswordInput
  ) {
    return this.users.resetPassword(user, id, body);
  }

  @Post(":id/revoke-sessions")
  @HttpCode(200)
  revokeSessions(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.users.revokeSessions(user, id);
  }

  @Post(":id/unlock")
  @HttpCode(200)
  unlock(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.users.unlock(user, id);
  }
}
