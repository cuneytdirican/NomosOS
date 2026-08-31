import { Body, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import {
  ApprovalWritePermission,
  ReadPermission,
  WritePermission,
} from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformUsersService } from "./platform-users.service";
import {
  platformUserCreateSchema,
  platformUserPatchSchema,
  type PlatformUserCreateInput,
  type PlatformUserPatchInput,
} from "./platform-users.schemas";

/**
 * `/api/admin/v1/platform-users` — YALNIZ SUPER_ADMIN.
 *
 * Yetki matrisi `platform_user.view` / `platform_user.manage` satırlarını
 * diğer tüm roller için "none" tanımlar; guard bunu zaten kesiyor, burada
 * ayrıca rol adı yazılmasına gerek yoktur (tek kaynak: matris).
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/platform-users`)
export class PlatformUsersController {
  constructor(private readonly users: PlatformUsersService) {}

  @Get()
  @ReadPermission("platform_user.view")
  list() {
    return this.users.list();
  }

  /** SUPER_ADMIN rolüyle oluşturma dört-göz onayına düşer (202 + talep). */
  @Post()
  @ApprovalWritePermission("platform_user.create") // denetim bulgusu K-11
  create(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(platformUserCreateSchema)) body: PlatformUserCreateInput
  ) {
    return this.users.create(user, body);
  }

  @Patch(":id")
  @WritePermission("platform_user.manage")
  patch(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(platformUserPatchSchema)) body: PlatformUserPatchInput
  ) {
    return this.users.patch(user, id, body);
  }

  /** Kalıcı silme YOKTUR: hesap pasifleştirilir, denetim izi korunur. */
  @Delete(":id")
  @WritePermission("platform_user.manage")
  deactivate(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.users.deactivate(user, id);
  }
}
