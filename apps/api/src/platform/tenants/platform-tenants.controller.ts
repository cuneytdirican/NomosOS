import { Body, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformTenantsService } from "./platform-tenants.service";
import {
  supportAccessSchema,
  tenantNoteSchema,
  tenantStatusSchema,
  tenantUpdateSchema,
  type SupportAccessInput,
  type TenantNoteInput,
  type TenantStatusInput,
  type TenantUpdateInput,
} from "./platform-tenants.schemas";

/** `/api/admin/v1/tenants` */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/tenants`)
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  @ReadPermission("tenant.view")
  list(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Query() query: { q?: string; plan?: string; status?: string; page?: string; limit?: string }
  ) {
    return this.tenants.list(user, query);
  }

  @Get(":id")
  @ReadPermission("tenant.view")
  detail(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.tenants.detail(user, id);
  }

  /**
   * Büro personel listesi — `tenant.view` DEĞİL, `tenant.users.view`.
   * Faturalama rolünün personel listesine ihtiyacı yoktur (alan ayrımı).
   */
  @Get(":id/users")
  @ReadPermission("tenant.users.view")
  users(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.tenants.users(user, id);
  }

  @Get(":id/ai-config")
  @ReadPermission("ai.provider_config")
  aiConfig(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.tenants.aiConfig(user, id);
  }

  @Get(":id/usage")
  @ReadPermission("tenant.usage.view")
  usage(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Query() query: { from?: string; to?: string }
  ) {
    return this.tenants.usage(user, id, query);
  }

  /** Büro adı gibi üstveri — yalnız SUPER_ADMIN / OPS_ADMIN (tenant.create). */
  @Patch(":id")
  @WritePermission("tenant.create")
  update(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(tenantUpdateSchema)) body: TenantUpdateInput
  ) {
    return this.tenants.update(user, id, body);
  }

  /** Panel ekibinin iç notu (Subscription.note alanında tutulur). */
  @Put(":id/note")
  @WritePermission("tenant.notes")
  setNote(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(tenantNoteSchema)) body: TenantNoteInput
  ) {
    return this.tenants.setNote(user, id, body);
  }

  /**
   * DÖRT-GÖZ: askıya alma doğrudan UYGULANMAZ, onay talebi üretir.
   * 202 döner — "kabul edildi, henüz uygulanmadı".
   */
  @Post(":id/suspend")
  @HttpCode(202)
  @WritePermission("tenant.suspend")
  suspend(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(tenantStatusSchema)) body: TenantStatusInput
  ) {
    return this.tenants.requestSuspend(user, id, body);
  }

  @Post(":id/activate")
  @HttpCode(202)
  @WritePermission("tenant.reactivate")
  activate(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(tenantStatusSchema)) body: TenantStatusInput
  ) {
    return this.tenants.requestActivate(user, id, body);
  }

  /** DÖRT-GÖZ: destek erişim penceresi talebi (impersonation ucu YOKTUR). */
  @Post(":id/support-access")
  @HttpCode(202)
  @WritePermission("support_grant.request")
  supportAccess(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(supportAccessSchema)) body: SupportAccessInput
  ) {
    return this.tenants.requestSupportAccess(user, id, body);
  }
}
