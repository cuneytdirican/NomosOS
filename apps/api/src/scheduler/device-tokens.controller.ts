import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { DeviceTokensService } from "./device-tokens.service";
import {
  deviceTokenRegisterSchema,
  type DeviceTokenRegisterInput,
} from "./device-tokens.schemas";

/**
 * `/api/v1/device-tokens` — KİRACI cihaz jetonu uçları (mobil hazırlığı).
 *
 * Kimlik zinciri global `JwtAuthGuard`tır: jeton, TOKEN'IN SAHİBİ kullanıcıya
 * bağlanır. Gövdeden `userId` alınmaz — alınsaydı bir kullanıcı, başkasının
 * hesabına kendi cihazını iliştirip o kişinin bildirimlerini okurdu.
 */
@Controller("device-tokens")
export class DeviceTokensController {
  constructor(private readonly devices: DeviceTokensService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.devices.list(user);
  }

  @Post()
  @HttpCode(200)
  register(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(deviceTokenRegisterSchema)) body: DeviceTokenRegisterInput
  ) {
    // 200 (201 değil): aynı cihaz her açılışta jetonunu tazeler; bu bir
    // "oluşturma" değil "bildirme" işlemidir ve çoğu çağrı mevcut kaydı günceller.
    return this.devices.register(user, body);
  }

  @Delete(":token")
  revoke(@CurrentUser() user: AuthUser, @Param("token") token: string) {
    return this.devices.revoke(user, token);
  }
}
