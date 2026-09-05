import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PlatformController } from "../platform/decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../platform/decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../platform/decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform/platform.constants";
import type { PlatformAuthUser } from "../platform/platform.types";
import { INTEREST_KINDS, TarifeService, harcTarifesiSchema, interestPeriodSchema, type HarcTarifesiInput, type InterestPeriodInput } from "./tarife.service";
import type { InterestRateKind } from "@nomosos/db";

/** Kiracı (salt okur): GET /finance/faiz-oranlari?kind= · GET /finance/harc-tarifesi/:yil */
@Controller("finance")
export class TarifeController {
  constructor(private readonly tarife: TarifeService) {}

  @Get("faiz-oranlari")
  faizOranlari(@Query("kind") kind?: string) {
    const k = (INTEREST_KINDS as readonly string[]).includes(kind ?? "") ? (kind as InterestRateKind) : undefined;
    return this.tarife.listInterestPeriods(k);
  }

  @Get("harc-tarifesi/:yil")
  harcTarifesi(@Param("yil", ParseIntPipe) yil: number) {
    return this.tarife.getHarcTarifesi(yil);
  }
}

/** Platform: /api/admin/v1/faiz-oranlari · /api/admin/v1/harc-tarifesi/:yil (judicial.view/manage) */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/faiz-oranlari`)
export class PlatformFaizOranlariController {
  constructor(private readonly tarife: TarifeService) {}

  @Get()
  @ReadPermission("judicial.view")
  list(@Query("kind") kind?: string) {
    const k = (INTEREST_KINDS as readonly string[]).includes(kind ?? "") ? (kind as InterestRateKind) : undefined;
    return this.tarife.listInterestPeriods(k);
  }

  @Post()
  @WritePermission("judicial.manage")
  upsert(@CurrentPlatformUser() user: PlatformAuthUser, @Body(new ZodValidationPipe(interestPeriodSchema)) body: InterestPeriodInput) {
    return this.tarife.upsertInterestPeriod(user, body);
  }

  @Delete(":id")
  @WritePermission("judicial.manage")
  remove(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.tarife.deleteInterestPeriod(user, id);
  }
}

@PlatformController(`${ADMIN_ROUTE_PREFIX}/harc-tarifesi`)
export class PlatformHarcTarifesiController {
  constructor(private readonly tarife: TarifeService) {}

  @Get(":yil")
  @ReadPermission("judicial.view")
  get(@Param("yil", ParseIntPipe) yil: number) {
    return this.tarife.getHarcTarifesi(yil);
  }

  @Put(":yil")
  @WritePermission("judicial.manage")
  upsert(@CurrentPlatformUser() user: PlatformAuthUser, @Param("yil", ParseIntPipe) yil: number, @Body(new ZodValidationPipe(harcTarifesiSchema)) body: HarcTarifesiInput) {
    return this.tarife.upsertHarcTarifesi(user, yil, body);
  }
}
