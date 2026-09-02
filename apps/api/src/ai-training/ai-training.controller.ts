/**
 * AI EĞİTİM VERİSİ UÇLARI.
 *
 * Kiracı:
 *   GET  /ai-training/summary          — rıza durumu + sayaçlar
 *   PATCH /ai-training/opt-in          — rıza aç/kapa (ADMIN/PARTNER)
 *   GET  /ai-training/samples          — kendi örnekleri (maske uygulanmış)
 *
 * Platform (dört-göz izli):
 *   POST /admin/v1/ai-training/export  — JSONL üret (ONAYLANMIŞ örneklerden)
 */

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { PlatformController } from "../platform/decorators/platform-controller.decorator";
import { ReadPermission, WritePermission } from "../platform/decorators/platform-permission.decorator";
import { CurrentPlatformUser } from "../platform/decorators/current-platform-user.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform/platform.constants";
import type { PlatformAuthUser } from "../platform/platform.types";
import { AiTrainingDataService } from "./ai-training.service";
import { PlatformAuditService } from "../platform/platform-audit.service";
import { PrismaService } from "../prisma/prisma.service";

const optInSchema = z.object({ optIn: z.boolean() });

@Controller("ai-training")
export class AiTrainingController {
  constructor(private readonly training: AiTrainingDataService) {}

  @Get("summary")
  summary(@CurrentUser() user: AuthUser) {
    return this.training.tenantSummary(user);
  }

  @Patch("opt-in")
  setOptIn(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(optInSchema)) body: { optIn: boolean },
  ) {
    assertRole(user, ROLE_SETS.ONAY, "AI eğitim verisi rıza değişikliği");
    return this.training.setOptIn(user, body.optIn);
  }

  @Get("samples")
  samples(
    @CurrentUser() user: AuthUser,
    @Query("kind") kind?: string,
    @Query("taskType") taskType?: string,
  ) {
    return this.training.listForTenant(user, { kind, taskType });
  }
}

@PlatformController(`${ADMIN_ROUTE_PREFIX}/ai-training`)
export class PlatformAiTrainingController {
  constructor(
    private readonly training: AiTrainingDataService,
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /** Liste — örnekler maske uygulanmış olarak zaten saklanır. */
  @Get("samples")
  @ReadPermission("aiProvider.view")
  list(
    @Query("tenantId") tenantId?: string,
    @Query("kind") kind?: string,
    @Query("limit") limit?: string,
  ) {
    const take = Math.min(parseInt(limit ?? "100", 10) || 100, 500);
    return this.prisma.client.aiTrainingSample.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(kind ? { kind } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        tenantId: true,
        taskType: true,
        kind: true,
        exportStatus: true,
        createdAt: true,
      },
    });
  }

  /** Örnek ONAYLA — yalnız onaylananlar JSONL dışa aktarımına girer. */
  @Post("samples/:id/approve")
  @HttpCode(200)
  @WritePermission("aiProvider.manage")
  async approve(@Param("id") id: string, @CurrentPlatformUser() actor: PlatformAuthUser) {
    const row = await this.prisma.client.aiTrainingSample.update({
      where: { id },
      data: { exportStatus: "ONAYLANDI" },
    });
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "AI_TRAINING_SAMPLE_APPROVE",
      entity: "AiTrainingSample",
      entityId: id,
      detail: `${row.taskType}/${row.kind} onaylandı (dışa aktarılabilir).`,
    });
    return { id, ok: true };
  }

  /** Örnek REDDET — kalitesiz örnek dışa çıkamaz. */
  @Post("samples/:id/reject")
  @HttpCode(200)
  @WritePermission("aiProvider.manage")
  async reject(@Param("id") id: string, @CurrentPlatformUser() actor: PlatformAuthUser) {
    const row = await this.prisma.client.aiTrainingSample.update({
      where: { id },
      data: { exportStatus: "REDDEDILDI" },
    });
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "AI_TRAINING_SAMPLE_REJECT",
      entity: "AiTrainingSample",
      entityId: id,
      detail: `${row.taskType}/${row.kind} reddedildi (dışa AKMAZ).`,
    });
    return { id, ok: true };
  }

  /**
   * JSONL üretimi — ONAYLANMIŞ örneklerden; üretim DENETİM İZİ taşır.
   * Uç dosya değil JSON satırları döndürür; platform arayüzü dosyaya yazar.
   */
  @Post("export")
  @HttpCode(200)
  @WritePermission("aiProvider.manage")
  async export(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Body(new ZodValidationPipe(z.object({ limit: z.number().int().positive().max(10000).optional() })))
    body: { limit?: number },
  ) {
    const jsonl = await this.training.exportJsonl(body.limit ?? 1000);
    const exported = jsonl.length > 0 ? jsonl.split("\n").length : 0;
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "AI_TRAINING_EXPORT",
      entity: "AiTrainingSample",
      detail: `${exported} örnek JSONL olarak üretildi (ONAYLANMIŞ).`,
    });
    return { jsonl, exported };
  }
}
