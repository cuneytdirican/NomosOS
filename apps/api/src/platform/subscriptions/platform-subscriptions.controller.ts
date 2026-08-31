import { Body, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
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
import { PlatformSubscriptionsService } from "./platform-subscriptions.service";
import {
  planPatchSchema,
  planUpsertSchema,
  subscriptionCancelSchema,
  subscriptionChangeSchema,
  subscriptionTransitionSchema,
  type PlanPatchInput,
  type PlanUpsertInput,
  type SubscriptionCancelInput,
  type SubscriptionChangeInput,
  type SubscriptionTransitionInput,
} from "./platform-subscriptions.schemas";

/** `/api/admin/v1/subscriptions` */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/subscriptions`)
export class PlatformSubscriptionsController {
  constructor(private readonly subscriptions: PlatformSubscriptionsService) {}

  @Get()
  @ReadPermission("subscription.view")
  list(@Query() query: { status?: string; plan?: string; page?: string; limit?: string }) {
    return this.subscriptions.list(query);
  }

  /** DÖRT-GÖZ: plan/koltuk değişimi onaysız uygulanmaz. */
  @Patch(":id")
  @HttpCode(202)
  @ApprovalWritePermission("tenant.plan_change") // denetim bulgusu K-11
  change(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(subscriptionChangeSchema)) body: SubscriptionChangeInput
  ) {
    return this.subscriptions.requestChange(user, id, body);
  }

  /** DÖRT-GÖZ: iptal terminaldir, geri alınamaz. */
  @Post(":id/cancel")
  @HttpCode(202)
  @ApprovalWritePermission("subscription.cancel") // denetim bulgusu K-11
  cancel(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(subscriptionCancelSchema)) body: SubscriptionCancelInput
  ) {
    return this.subscriptions.requestCancel(user, id, body);
  }

  /**
   * Durum geçişi. Yıkıcı hedefler (SUSPENDED/CANCELED) 202 + onay talebi,
   * diğerleri 200 + doğrudan uygulama döner.
   */
  @Post(":id/transition")
  @HttpCode(200)
  @WritePermission("subscription.transition")
  transition(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(subscriptionTransitionSchema)) body: SubscriptionTransitionInput
  ) {
    return this.subscriptions.transition(user, id, body);
  }
}

/** `/api/admin/v1/plans` — plan kataloğu. */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/plans`)
export class PlatformPlansController {
  constructor(private readonly subscriptions: PlatformSubscriptionsService) {}

  @Get()
  @ReadPermission("plan.catalog.view")
  list() {
    return this.subscriptions.listPlans();
  }

  /** DÖRT-GÖZ: fiyatlı yeni plan tek imzayla yaratılamaz (denetim bulgusu K-11). */
  @Post()
  @HttpCode(202)
  @ApprovalWritePermission("plan.catalog.price")
  create(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(planUpsertSchema)) body: PlanUpsertInput
  ) {
    return this.subscriptions.createPlan(user, body);
  }

  @Patch(":id")
  @WritePermission("plan.catalog.write")
  patch(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(planPatchSchema)) body: PlanPatchInput
  ) {
    return this.subscriptions.patchPlan(user, id, body);
  }
}
