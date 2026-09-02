import { Body, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { FineTuneService } from "./fine-tune.service";
import {
  fineTuneCreateSchema,
  fineTuneStatusSchema,
  type FineTuneCreateInput,
  type FineTuneStatusInput,
} from "./fine-tune.schemas";

/**
 * `/api/admin/v1/fine-tune-jobs` — D5 / M4.
 *
 * Sağlayıcıya otomatik gönderim YOKTUR: uçlar iş kaydını, şerit denetimli
 * durum geçişlerini ve manifest (JSONL) üretimini kapsar. Manifestin
 * sağlayıcıya yüklenmesi operatörün ELLE yaptığı, sistemin DIŞINDA bir
 * adımdır — denetim izinde bu böyle yazılıdır.
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/fine-tune-jobs`)
export class FineTuneController {
  constructor(private readonly fineTune: FineTuneService) {}

  @Get()
  @ReadPermission("aiProvider.view")
  list() {
    return this.fineTune.list();
  }

  @Post()
  @WritePermission("aiProvider.manage")
  @HttpCode(201)
  create(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(fineTuneCreateSchema)) body: FineTuneCreateInput
  ) {
    return this.fineTune.create(user, body);
  }

  /** Manifest — işin ONAYLANMIŞ örnek havuzunun JSONL dökümü. */
  @Get(":id/manifest")
  @WritePermission("aiProvider.manage")
  manifest(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.fineTune.manifest(user, id);
  }

  /** Durum geçişi — şerit denetimli; TAMAMLANDI sonuç model adı ister. */
  @Post(":id/status")
  @WritePermission("aiProvider.manage")
  @HttpCode(200)
  setStatus(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(fineTuneStatusSchema)) body: FineTuneStatusInput
  ) {
    return this.fineTune.setStatus(user, id, body);
  }
}
