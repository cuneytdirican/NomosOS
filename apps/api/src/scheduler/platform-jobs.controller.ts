import { Body, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PlatformController } from "../platform/decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../platform/decorators/current-platform-user.decorator";
import {
  ReadPermission,
  WritePermission,
} from "../platform/decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform/platform.constants";
import type { PlatformAuthUser } from "../platform/platform.types";
import { PlatformJobsService } from "./platform-jobs.service";
import {
  jobPatchSchema,
  jobRunSchema,
  type JobPatchInput,
  type JobRunInput,
} from "./platform-jobs.schemas";

/**
 * `/api/admin/v1/jobs` — ZAMANLANMIŞ İŞ YÖNETİMİ (PLATFORM TARAFI).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ KİRACI TARAFI YOKTUR VE OLMAMALIDIR.                                     ║
 * ║ `ScheduledJob` SİSTEM GENELİdir (tenantId taşımaz); bir iş TÜM kiracıları ║
 * ║ dolaşır. Bir büronun ortağına "gece işlerini kapat" düğmesi vermek, o    ║
 * ║ düğmenin bütün büroları etkilemesi demek olurdu.                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * YETKİ — `system.settings` KULLANILIR:
 *   Matriste bu aksiyonun rol profili tam olarak istenen kümedir:
 *   SUPER_ADMIN = full, OPS_ADMIN = full, BILLING_ADMIN/SUPPORT_AGENT/
 *   ANALYST_READONLY = none. Yani "OPS_ADMIN + SUPER_ADMIN" gereksinimi
 *   birebir karşılanır ve ANALYST_READONLY `WritePermission` üzerinden her
 *   koşulda reddedilir (`canMutate` bu rol için daima false'tur).
 *
 *   Adanmış bir `system.jobs` aksiyonu daha okunur olurdu; ancak
 *   `platform/platform-permissions.ts` bu ajanın dosya sahipliğinde DEĞİLDİR
 *   ve matrise tek taraflı satır eklemek `apps/admin/src/lib/rbac.ts` ikiziyle
 *   ayrışma üretirdi. Aksiyon adı değiştiğinde İKİ dosya birden güncellenmeli;
 *   entegrasyon notlarına düşüldü. Mevcut hâl DAHA DAR bir kapı açmaz —
 *   zamanlanmış iş yönetimi, kelimenin tam anlamıyla bir sistem ayarıdır.
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/jobs`)
export class PlatformJobsController {
  constructor(private readonly jobs: PlatformJobsService) {}

  /** İş tanımları + son çalışma durumu + zamanlayıcının kendi durumu. */
  @Get()
  @ReadPermission("system.settings")
  list() {
    return this.jobs.list();
  }

  /** Çalışma geçmişi (append-only JobRun günlüğü). */
  @Get(":key/runs")
  @ReadPermission("system.settings")
  runs(
    @Param("key") key: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.jobs.runs(key, { status, page, limit });
  }

  /**
   * Elle tetikleme. DÖRT-GÖZ GEREKTİRMEZ ama PlatformAuditLog'a yazılır.
   * 200 döner (201 değil): kaynak yaratmaz, bir koşu yürütür ve özetini verir.
   */
  @Post(":key/run")
  @HttpCode(200)
  @WritePermission("system.settings")
  run(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(jobRunSchema)) body: JobRunInput
  ) {
    return this.jobs.trigger(user, key, body);
  }

  /** Aç/kapat ve cron değiştir. Değişiklik kuyruğa anında yansır. */
  @Patch(":key")
  @WritePermission("system.settings")
  patch(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(jobPatchSchema)) body: JobPatchInput
  ) {
    return this.jobs.patch(user, key, body);
  }
}
