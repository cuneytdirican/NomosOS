import { Body, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import { isAnalyst } from "../platform-permissions";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformHealthService } from "./platform-health.service";
import { PlatformSystemService } from "./platform-system.service";
import {
  announcementCreateSchema,
  announcementPatchSchema,
  flagCreateSchema,
  flagPatchSchema,
  maintenanceLockSchema,
  settingPutSchema,
  type AnnouncementCreateInput,
  type AnnouncementPatchInput,
  type FlagCreateInput,
  type FlagPatchInput,
  type MaintenanceLockInput,
  type SettingPutInput,
} from "./platform-system.schemas";

/** `/api/admin/v1/settings` */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/settings`)
export class PlatformSettingsController {
  constructor(private readonly system: PlatformSystemService) {}

  @Get()
  @ReadPermission("system.settings")
  list() {
    return this.system.listSettings();
  }

  /** DÖRT-GÖZ: bakım TAM KİLİDİ ayrı uçtan ve onayla açılır. */
  @Post("maintenance-lock")
  @HttpCode(202)
  @WritePermission("system.maintenance_lock")
  maintenanceLock(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(maintenanceLockSchema)) body: MaintenanceLockInput
  ) {
    return this.system.requestMaintenanceLock(user, body);
  }

  @Put(":key")
  @WritePermission("system.settings")
  put(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(settingPutSchema)) body: SettingPutInput
  ) {
    return this.system.putSetting(user, key, body);
  }
}

/** `/api/admin/v1/feature-flags` */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/feature-flags`)
export class PlatformFlagsController {
  constructor(private readonly system: PlatformSystemService) {}

  @Get()
  @ReadPermission("system.flag_write")
  list() {
    return this.system.listFlags();
  }

  @Post()
  @WritePermission("system.flag_write")
  create(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(flagCreateSchema)) body: FlagCreateInput
  ) {
    return this.system.createFlag(user, body);
  }

  /**
   * Tenant allowlist değişikliği doğrudan uygulanır (200);
   * `isEnabledGlobally` değişikliği onay talebi üretir (yanıtta
   * `approvalRequired: true`).
   */
  @Patch(":id")
  @WritePermission("system.flag_write")
  patch(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(flagPatchSchema)) body: FlagPatchInput
  ) {
    return this.system.patchFlag(user, id, body);
  }
}

/** `/api/admin/v1/announcements` */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/announcements`)
export class PlatformAnnouncementsController {
  constructor(private readonly system: PlatformSystemService) {}

  @Get()
  @ReadPermission("announcement.view")
  list(@Query() query: { activeOnly?: string }) {
    return this.system.listAnnouncements(query);
  }

  @Post()
  @WritePermission("announcement.publish")
  create(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(announcementCreateSchema)) body: AnnouncementCreateInput
  ) {
    return this.system.createAnnouncement(user, body);
  }

  @Patch(":id")
  @WritePermission("announcement.publish")
  patch(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(announcementPatchSchema)) body: AnnouncementPatchInput
  ) {
    return this.system.patchAnnouncement(user, id, body);
  }

  @Delete(":id")
  @WritePermission("announcement.publish")
  remove(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.system.deleteAnnouncement(user, id);
  }
}

/**
 * `/api/admin/v1/health` — GERÇEK bağlantı denemesi yapar (DB/Redis/S3).
 *
 * Tenant tarafındaki `/api/v1/health` ucundan farklıdır: o, yük dengeleyici
 * için sabit bir canlılık sinyalidir; bu ise operasyonun bağımlılık panosudur.
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/health`)
export class PlatformHealthController {
  constructor(private readonly health: PlatformHealthService) {}

  @Get()
  @ReadPermission("system.health.uptime")
  check(@CurrentPlatformUser() user: PlatformAuthUser) {
    // Matris: ANALYST_READONLY yalnız uptime satırını görür (🔒),
    // bileşen ayrıntıları ve hata metinleri bu role kapalıdır.
    if (isAnalyst(user.role)) return this.health.uptimeOnly();
    return this.health.check();
  }
}
