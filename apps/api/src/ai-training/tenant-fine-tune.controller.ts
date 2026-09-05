/**
 * `/ai-training/fine-tune-jobs` — KİRACI model eğitim işleri (kullanıcı
 * tanımlı model eğitimi, gereksinim 2). Kimlik: küresel JwtAuthGuard (tenant).
 *
 *   GET    /                 — kendi işleri + lisans durumu + havuz anlık görüntüsü
 *   POST   /                 — { name, providerConfigId, note? } (lisans + sahiplik kapısı)
 *   GET    /:id/manifest     — yalnız kendi kiracısının ONAYLANMIŞ örnekleri (JSONL)
 *   POST   /:id/status       — şerit denetimli durum geçişi
 *
 * RAG "yeniden eğitimi" ayrı uç DEĞİLDİR: dosya bazında yeniden indeksleme
 * mevcut `POST /assistant/index/:caseId` ({ force: true }) ile yapılır.
 */

import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import {
  fineTuneStatusSchema,
  tenantFineTuneCreateSchema,
  type FineTuneStatusInput,
  type TenantFineTuneCreateInput,
} from "../platform/fine-tune/fine-tune.schemas";
import { TenantFineTuneService } from "./tenant-fine-tune.service";

@Controller("ai-training/fine-tune-jobs")
export class TenantFineTuneController {
  constructor(private readonly fineTune: TenantFineTuneService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.fineTune.list(user);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(tenantFineTuneCreateSchema)) body: TenantFineTuneCreateInput,
  ) {
    return this.fineTune.create(user, body);
  }

  @Get(":id/manifest")
  manifest(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.fineTune.manifest(user, id);
  }

  @Post(":id/status")
  @HttpCode(200)
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(fineTuneStatusSchema)) body: FineTuneStatusInput,
  ) {
    return this.fineTune.setStatus(user, id, body);
  }
}
